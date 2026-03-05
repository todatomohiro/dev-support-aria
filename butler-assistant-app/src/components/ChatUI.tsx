import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message } from '@/types'
import { ttsService } from '@/services/ttsService'
import { formatTime } from '@/utils'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
import { useVAD } from '@/hooks/useVAD'
import { CameraPreview } from './CameraPreview'
import type { CameraPreviewHandle } from './CameraPreview'

const MapView = lazy(() => import('./MapView').then(m => ({ default: m.MapView })))

/** URL 検出用の正規表現 */
const URL_REGEX = /https?:\/\/\S+/g

/**
 * テキスト中の URL をクリック可能なリンクに変換
 * @param text - メッセージテキスト
 * @param isUser - ユーザーメッセージかどうか（スタイル切り替え用）
 */
function linkifyContent(text: string, isUser: boolean): React.ReactNode[] {
  if (!text) return [text ?? '']
  const result: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  const regex = new RegExp(URL_REGEX)
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index))
    }
    const url = match[0]
    const linkClass = isUser
      ? 'text-white underline'
      : 'text-blue-600 dark:text-blue-400 underline'
    result.push(
      <a key={match.index} href={url} target="_blank" rel="noopener noreferrer" className={linkClass}>
        {url}
      </a>
    )
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex))
  }
  return result
}

/** 入力エリアのオプション定義 */
export interface InputOption {
  key: string
  label: string
  icon: string
  enabled: boolean
  onToggle: (enabled: boolean) => void
}

interface ChatUIProps {
  messages: Message[]
  isLoading: boolean
  onSendMessage: (text: string, imageBase64?: string) => void
  ttsEnabled: boolean
  onToggleTts: (enabled: boolean) => void
  cameraEnabled: boolean
  onToggleCamera: (enabled: boolean) => void
  developerMode?: boolean
  hasEarlierMessages?: boolean
  isLoadingEarlier?: boolean
  onLoadEarlier?: () => void
  onCreateTheme?: (themeName: string) => void
  /** テキスト入力時の感情分析コールバック */
  onInputSentimentChange?: (text: string) => void
  /** 入力エリアに追加表示する要素（モデルセレクタ等） */
  inputExtra?: React.ReactNode
  /** 追加オプション（壁打ちモード等） */
  extraOptions?: InputOption[]
  /** ワーク定義の常時表示クイックリプライ */
  persistentReplies?: string[]
  /** クイックリプライ送信テンプレート（{reply} がラベルに置換） */
  persistentRepliesTemplate?: string
}

/**
 * チャットUI コンポーネント
 */
export function ChatUI({ messages, isLoading, onSendMessage, ttsEnabled, onToggleTts, cameraEnabled, onToggleCamera, developerMode = false, hasEarlierMessages = false, isLoadingEarlier = false, onLoadEarlier, onCreateTheme, onInputSentimentChange, inputExtra, extraOptions = [], persistentReplies, persistentRepliesTemplate }: ChatUIProps) {
  const [inputText, setInputText] = useState('')
  const [autoSendEnabled, setAutoSendEnabled] = useState(false)
  const [isPopoverOpen, setIsPopoverOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollHeightBeforeRef = useRef<number>(0)
  const isLoadingEarlierRef = useRef(false)
  const autoSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputTextRef = useRef('')
  const autoSendEnabledRef = useRef(false)
  const isLoadingRef = useRef(false)
  const cameraCaptureRef = useRef<CameraPreviewHandle>(null)
  const optionsContainerRef = useRef<HTMLDivElement>(null)

  const { status: sttStatus, interimText, error: sttError, toggleListening, isSupported: sttSupported } =
    useSpeechRecognition({
      lang: 'ja-JP',
      continuous: autoSendEnabled,
      onResult: (text) => {
        setInputText((prev) => prev + text)
        resetAutoSendTimer()
      },
    })

  const { isSpeaking: vadSpeaking, silenceDurationMs, startMonitoring: vadStart, stopMonitoring: vadStop, isSupported: vadSupported } = useVAD()
  const vadSpeakingRef = useRef(false)

  // ref を最新値に同期（setTimeout クロージャ問題回避）
  useEffect(() => { inputTextRef.current = inputText }, [inputText])
  useEffect(() => { autoSendEnabledRef.current = autoSendEnabled }, [autoSendEnabled])
  useEffect(() => { isLoadingRef.current = isLoading }, [isLoading])
  useEffect(() => { vadSpeakingRef.current = vadSpeaking }, [vadSpeaking])

  // autoSendEnabled + VAD 対応時、マイク監視を連動
  useEffect(() => {
    if (autoSendEnabled && vadSupported) {
      vadStart()
    } else {
      vadStop()
    }
  }, [autoSendEnabled, vadSupported, vadStart, vadStop])

  /** テキスト長に応じた動的ディレイを返す */
  const getAutoSendDelay = useCallback((textLength: number): number => {
    if (textLength <= 10) return 1000
    if (textLength <= 30) return 1500
    return 2500
  }, [])

  /** 自動送信タイマーをリセット */
  const resetAutoSendTimer = useCallback(() => {
    if (autoSendTimerRef.current) {
      clearTimeout(autoSendTimerRef.current)
      autoSendTimerRef.current = null
    }
    if (!autoSendEnabledRef.current || isLoadingRef.current) return
    // VAD 対応時: 発話中はタイマーを設定しない
    if (vadSupported && vadSpeakingRef.current) return
    const text = inputTextRef.current.trim()
    const delay = vadSupported ? getAutoSendDelay(text.length) : 3500
    autoSendTimerRef.current = setTimeout(() => {
      // VAD 対応時: 送信直前にも発話中チェック
      if (vadSupported && vadSpeakingRef.current) {
        autoSendTimerRef.current = null
        return
      }
      const currentText = inputTextRef.current.trim()
      if (currentText) {
        const image = cameraCaptureRef.current?.captureFrame() ?? undefined
        onSendMessage(currentText, image)
        setInputText('')
      }
      autoSendTimerRef.current = null
    }, delay)
  }, [onSendMessage, vadSupported, getAutoSendDelay])

  // VAD: 無音検出時に動的タイマーで自動送信判定
  useEffect(() => {
    if (!vadSupported || !autoSendEnabledRef.current || isLoadingRef.current) return
    if (vadSpeaking) {
      // 発話再開 → タイマーキャンセル
      if (autoSendTimerRef.current) {
        clearTimeout(autoSendTimerRef.current)
        autoSendTimerRef.current = null
      }
      return
    }
    // 無音状態 + テキストあり → タイマー開始
    const text = inputTextRef.current.trim()
    if (!text) return
    const delay = getAutoSendDelay(text.length)
    if (silenceDurationMs >= delay && !autoSendTimerRef.current) {
      const image = cameraCaptureRef.current?.captureFrame() ?? undefined
      onSendMessage(text, image)
      setInputText('')
    }
  }, [vadSpeaking, silenceDurationMs, vadSupported, getAutoSendDelay, onSendMessage])

  // 中間結果（話し続けている最中）でもタイマーリセット（VAD非対応時のフォールバック）
  useEffect(() => {
    if (interimText && autoSendEnabledRef.current && !isLoadingRef.current && !vadSupported) {
      resetAutoSendTimer()
    }
  }, [interimText, resetAutoSendTimer, vadSupported])

  // 返事が来た後、入力テキストがあればタイマー開始
  useEffect(() => {
    if (!isLoading && autoSendEnabledRef.current && inputTextRef.current.trim()) {
      resetAutoSendTimer()
    }
  }, [isLoading, resetAutoSendTimer])

  // 自動送信 OFF 時にタイマーをクリア
  useEffect(() => {
    if (!autoSendEnabled && autoSendTimerRef.current) {
      clearTimeout(autoSendTimerRef.current)
      autoSendTimerRef.current = null
    }
  }, [autoSendEnabled])

  // アンマウント時にタイマーをクリア
  useEffect(() => {
    return () => {
      if (autoSendTimerRef.current) {
        clearTimeout(autoSendTimerRef.current)
      }
    }
  }, [])

  // メッセージ変更時: 過去読み込み時はスクロール位置復元、それ以外は最下部へスクロール
  useEffect(() => {
    const container = scrollContainerRef.current
    if (container && isLoadingEarlierRef.current) {
      // 読み込み前のスクロール高さとの差分だけスクロール位置を調整
      const diff = container.scrollHeight - scrollHeightBeforeRef.current
      container.scrollTop += diff
      isLoadingEarlierRef.current = false
    } else {
      scrollToBottom()
    }
  }, [messages])

  /** 過去のメッセージを読み込む */
  const handleLoadEarlier = useCallback(() => {
    if (!onLoadEarlier || isLoadingEarlier) return
    // フラグを立てて scrollToBottom を抑制
    isLoadingEarlierRef.current = true
    // スクロール位置を記録
    if (scrollContainerRef.current) {
      scrollHeightBeforeRef.current = scrollContainerRef.current.scrollHeight
    }
    onLoadEarlier()
  }, [onLoadEarlier, isLoadingEarlier])

  const isInitialScrollRef = useRef(true)
  const [showScrollButton, setShowScrollButton] = useState(false)

  const scrollToBottom = () => {
    const behavior = isInitialScrollRef.current ? 'instant' as ScrollBehavior : 'smooth'
    isInitialScrollRef.current = false
    messagesEndRef.current?.scrollIntoView({ behavior })
  }

  /** スクロール位置を監視して「最新へ」ボタンの表示を切り替え */
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const handleScroll = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      setShowScrollButton(distanceFromBottom > 100)
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value)
    onInputSentimentChange?.(e.target.value)
  }

  const handleSendClick = () => {
    if (inputText.trim() && !isLoading) {
      if (autoSendTimerRef.current) {
        clearTimeout(autoSendTimerRef.current)
        autoSendTimerRef.current = null
      }
      const image = cameraCaptureRef.current?.captureFrame() ?? undefined
      onSendMessage(inputText.trim(), image)
      setInputText('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME 変換中は送信しない
    if (e.nativeEvent.isComposing) return
    // Shift+Enterで改行、Enterのみで送信
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendClick()
    }
  }

  // ポップオーバー外側クリックで閉じる
  useEffect(() => {
    if (!isPopoverOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (optionsContainerRef.current && !optionsContainerRef.current.contains(e.target as Node)) {
        setIsPopoverOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isPopoverOpen])

  // 組み込みオプションを InputOption[] に変換
  const builtinOptions: InputOption[] = [
    ...(sttSupported ? [{
      key: 'auto-send',
      label: '音声自動送信',
      icon: '🎤',
      enabled: autoSendEnabled,
      onToggle: (enabled: boolean) => setAutoSendEnabled(enabled),
    }] : []),
    {
      key: 'camera',
      label: 'カメラ',
      icon: '📷',
      enabled: cameraEnabled,
      onToggle: (enabled: boolean) => onToggleCamera(enabled),
    },
    ...(developerMode ? [{
      key: 'tts',
      label: '自動読み上げ',
      icon: '🔊',
      enabled: ttsEnabled,
      onToggle: (enabled: boolean) => onToggleTts(enabled),
    }] : []),
  ]
  const allOptions = [...builtinOptions, ...extraOptions]
  const activeOptions = allOptions.filter((o) => o.enabled)

  return (
    <div className="relative flex flex-col h-full bg-white dark:bg-gray-900">
      {/* メッセージ履歴エリア */}
      <div className="flex-1 overflow-y-auto p-2 sm:p-4 space-y-2 sm:space-y-4" ref={scrollContainerRef}>
        {hasEarlierMessages && (
          <div className="flex justify-center py-2">
            <button
              onClick={handleLoadEarlier}
              disabled={isLoadingEarlier}
              className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
              data-testid="load-earlier-button"
            >
              {isLoadingEarlier ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  読み込み中...
                </span>
              ) : (
                '過去のメッセージを読み込む'
              )}
            </button>
          </div>
        )}
        {messages.map((message) => (
          <div key={message.id}>
            <MessageBubble message={message} developerMode={developerMode} />
            {message.suggestedTheme && onCreateTheme && (
              <ThemeSuggestionCard
                themeName={message.suggestedTheme.themeName}
                onCreateTheme={onCreateTheme}
              />
            )}
          </div>
        ))}

        {/* スケルトンメッセージ（ローディング中） */}
        {isLoading && <SkeletonMessage />}

        {/* スクロール用のアンカー */}
        <div ref={messagesEndRef} />
      </div>

      {/* 最新メッセージへ戻るボタン */}
      {showScrollButton && (
        <button
          onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
          className="absolute bottom-36 right-4 z-10 w-10 h-10 rounded-full bg-purple-600 text-white shadow-lg hover:bg-purple-700 transition-all flex items-center justify-center opacity-80 hover:opacity-100"
          title="最新メッセージへ"
          data-testid="scroll-to-bottom-button"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      )}

      {/* クイックリプライ */}
      {!isLoading && (() => {
        // 常時表示リプライ or 最新アシスタントメッセージのリプライ
        const lastMsg = messages[messages.length - 1]
        const isPersistent = Boolean(persistentReplies?.length)
        const replies = isPersistent
          ? persistentReplies
          : (lastMsg?.role === 'assistant' ? lastMsg.suggestedReplies : undefined)
        const template = isPersistent ? persistentRepliesTemplate : undefined
        return replies?.length ? (
          <div className="flex gap-2 overflow-x-auto px-2 sm:px-4 py-1.5 border-t border-gray-200 dark:border-gray-700" data-testid="quick-replies">
            {replies.map((reply) => (
              <button
                key={reply}
                type="button"
                onClick={() => onSendMessage(template ? template.replace('{reply}', reply) : reply)}
                className="shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors"
                data-testid="quick-reply-button"
              >
                {reply}
              </button>
            ))}
          </div>
        ) : null
      })()}

      {/* 入力エリア */}
      <div className="border-t border-gray-200 dark:border-gray-700 p-2 sm:p-4">
        <CameraPreview ref={cameraCaptureRef} enabled={cameraEnabled} />
        {/* 中間結果（認識中テキスト） */}
        {interimText && (
          <p className="text-xs text-gray-400 italic px-1 mb-1 truncate">
            {interimText}
          </p>
        )}
        {/* STT エラー表示 */}
        {sttError && (
          <p className="text-xs text-red-500 px-1 mb-1">
            {sttError}
          </p>
        )}
        {/* 入力コンテナ（textarea + ツールバーを1つのボーダーで囲む） */}
        <div className="rounded-2xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 focus-within:border-blue-500 dark:focus-within:border-blue-400 transition-colors">
          {/* Row 1: textarea + 送信アイコン */}
          <div className="relative">
            <textarea
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="メッセージを入力..."
              className="w-full resize-none bg-transparent text-gray-900 dark:text-gray-100 p-2.5 sm:p-3 pr-11 text-sm sm:text-base border-none"
              style={{ outline: 'none', boxShadow: 'none' }}
              rows={1}
              disabled={isLoading}
              data-testid="chat-input"
            />
            <button
              onClick={handleSendClick}
              disabled={!inputText.trim() || isLoading}
              className={`absolute right-2 bottom-1.5 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-all ${
                !inputText.trim() || isLoading ? 'opacity-0 pointer-events-none' : 'opacity-100'
              }`}
              data-testid="send-button"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          {/* Row 2: ツールバー */}
          <div className="flex items-center gap-1.5 px-1.5 pb-1.5">
          {/* + ボタン（将来のファイル添付用） */}
          <button
            type="button"
            disabled
            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-gray-400 dark:text-gray-500 cursor-not-allowed"
            title="ファイル添付（準備中）"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          {/* ⚙ オプションボタン + ポップオーバー */}
          <div className="relative" ref={optionsContainerRef}>
            <button
              type="button"
              onClick={() => setIsPopoverOpen(!isPopoverOpen)}
              className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                isPopoverOpen
                  ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
              title="オプション"
              data-testid="options-button"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            {isPopoverOpen && (
              <div className="absolute left-0 bottom-full mb-2 min-w-[180px] rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-1 z-20" data-testid="options-popover">
                {allOptions.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => opt.onToggle(!opt.enabled)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    data-testid={`option-${opt.key}`}
                  >
                    <span className="w-5 text-center">{opt.icon}</span>
                    <span className="flex-1 text-left">{opt.label}</span>
                    {opt.enabled && (
                      <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* アクティブオプション チップ */}
          {activeOptions.map((opt) => (
            <span
              key={opt.key}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
              data-testid={`chip-${opt.key}`}
            >
              {opt.icon} {opt.label}
              <button
                type="button"
                onClick={() => opt.onToggle(false)}
                className="ml-0.5 hover:text-blue-900 dark:hover:text-blue-100 transition-colors"
                title={`${opt.label}を解除`}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
          <div className="flex-1" />
          {inputExtra}
          {/* マイクボタン（対応ブラウザのみ） */}
          {sttSupported && (
            <button
              onClick={toggleListening}
              className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                sttStatus === 'listening'
                  ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
              title={sttStatus === 'listening' ? '音声認識を停止' : '音声入力'}
              data-testid="stt-mic-button"
            >
              {sttStatus === 'listening' ? (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              )}
            </button>
          )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * メッセージバブル コンポーネント
 */
function MessageBubble({ message, developerMode = false }: { message: Message; developerMode?: boolean }) {
  const isUser = message.role === 'user'
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [showDebug, setShowDebug] = useState(false)

  // rawResponse から enhancedSystemPrompt を抽出
  const promptText = (() => {
    if (!developerMode || isUser || !message.rawResponse) return null
    try {
      const raw = JSON.parse(message.rawResponse)
      return (raw.enhancedSystemPrompt as string) || null
    } catch {
      return null
    }
  })()

  const handleSpeak = useCallback(async () => {
    if (isSpeaking) {
      ttsService.stop()
      setIsSpeaking(false)
      return
    }
    setIsSpeaking(true)
    try {
      await ttsService.synthesizeAndPlay(message.content)
    } finally {
      setIsSpeaking(false)
    }
  }, [message.content, isSpeaking])

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
      data-testid="message-bubble"
      data-timestamp={message.timestamp}
      data-role={message.role}
    >
      <div
        className={`max-w-[85%] sm:max-w-[70%] rounded-lg p-2 sm:p-3 ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-sm sm:text-base">{linkifyContent(message.content, true)}</p>
        ) : (
          <div className="markdown-content text-sm sm:text-base">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
        {message.mapData && (
          <Suspense fallback={<div className="w-full h-48 rounded-md bg-gray-200 dark:bg-gray-700 animate-pulse mt-2" />}>
            <MapView mapData={message.mapData} />
          </Suspense>
        )}
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] sm:text-xs opacity-70">
            {formatTime(message.timestamp)}
          </span>
          <div className="flex items-center">
            {!isUser && developerMode && promptText && (
              <button
                onClick={() => setShowDebug((prev) => !prev)}
                className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold opacity-60 hover:opacity-100 transition-opacity bg-purple-500/20 hover:bg-purple-500/30 text-purple-700 dark:text-purple-300"
                title="システムプロンプトを表示"
                data-testid="debug-info-toggle"
              >
                PROMPT
              </button>
            )}
            {!isUser && developerMode && message.rawResponse && (
              <button
                onClick={() => setShowRaw((prev) => !prev)}
                className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold opacity-60 hover:opacity-100 transition-opacity bg-black/10 dark:bg-white/10 hover:bg-black/20 dark:hover:bg-white/20"
                title="Raw JSON を表示"
                data-testid="raw-json-toggle"
              >
                JSON
              </button>
            )}
            {!isUser && (
              <button
                onClick={handleSpeak}
                className="ml-2 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 opacity-60 hover:opacity-100 transition-opacity"
                title={isSpeaking ? '停止' : '読み上げ'}
                data-testid="tts-speak-button"
              >
                {isSpeaking ? (
                  <svg className="w-3.5 h-3.5 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                  </svg>
                )}
              </button>
            )}
          </div>
        </div>
        {showDebug && promptText && (
          <pre
            className="mt-2 p-2 rounded text-xs bg-purple-950/80 text-purple-200 overflow-x-auto whitespace-pre-wrap break-words max-h-[60vh] overflow-y-auto"
            data-testid="debug-info-content"
          >
            {promptText}
          </pre>
        )}
        {showRaw && message.rawResponse && (
          <pre
            className="mt-2 p-2 rounded text-xs bg-gray-900 text-green-400 overflow-x-auto whitespace-pre-wrap break-all"
            data-testid="raw-json-content"
          >
            {message.rawResponse}
          </pre>
        )}
      </div>
    </div>
  )
}

/**
 * テーマ提案カード コンポーネント
 */
function ThemeSuggestionCard({ themeName, onCreateTheme }: { themeName: string; onCreateTheme: (name: string) => void }) {
  const [dismissed, setDismissed] = useState(false)
  const [creating, setCreating] = useState(false)

  if (dismissed) return null

  const handleCreate = async () => {
    setCreating(true)
    try {
      onCreateTheme(themeName)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex justify-start mt-1 mb-2" data-testid="theme-suggestion-card">
      <div className="max-w-[85%] sm:max-w-[70%] flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 text-sm">
        <svg className="w-4 h-4 shrink-0 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span className="text-gray-700 dark:text-gray-300">
          「{themeName}」のトピックを作成する？
        </span>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="shrink-0 px-2.5 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 rounded-md transition-colors"
          data-testid="theme-suggestion-create"
        >
          {creating ? '...' : '作成'}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          title="閉じる"
          data-testid="theme-suggestion-dismiss"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}

/**
 * スケルトンメッセージ コンポーネント（アシスタント吹き出し風ローディング）
 */
function SkeletonMessage() {
  return (
    <div className="flex justify-start" data-testid="loading-indicator">
      <div className="w-48 sm:w-64 rounded-lg p-3 bg-gray-100 dark:bg-gray-800 space-y-2">
        <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded animate-pulse w-3/4" />
        <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded animate-pulse w-1/2" />
        <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded animate-pulse w-2/3" />
      </div>
    </div>
  )
}

