import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message } from '@/types'
import { ttsService } from '@/services/ttsService'
import { formatTime } from '@/utils'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
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
  /** 入力エリアに追加表示する要素（モデルセレクタ等） */
  inputExtra?: React.ReactNode
}

/**
 * チャットUI コンポーネント
 */
export function ChatUI({ messages, isLoading, onSendMessage, ttsEnabled, onToggleTts, cameraEnabled, onToggleCamera, developerMode = false, hasEarlierMessages = false, isLoadingEarlier = false, onLoadEarlier, onCreateTheme, inputExtra }: ChatUIProps) {
  const [inputText, setInputText] = useState('')
  const [autoSendEnabled, setAutoSendEnabled] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollHeightBeforeRef = useRef<number>(0)
  const isLoadingEarlierRef = useRef(false)
  const autoSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputTextRef = useRef('')
  const autoSendEnabledRef = useRef(false)
  const isLoadingRef = useRef(false)
  const cameraCaptureRef = useRef<CameraPreviewHandle>(null)

  const { status: sttStatus, interimText, error: sttError, toggleListening, isSupported: sttSupported } =
    useSpeechRecognition({
      lang: 'ja-JP',
      continuous: autoSendEnabled,
      onResult: (text) => {
        setInputText((prev) => prev + text)
        resetAutoSendTimer()
      },
    })

  // ref を最新値に同期（setTimeout クロージャ問題回避）
  useEffect(() => { inputTextRef.current = inputText }, [inputText])
  useEffect(() => { autoSendEnabledRef.current = autoSendEnabled }, [autoSendEnabled])
  useEffect(() => { isLoadingRef.current = isLoading }, [isLoading])


  /** 自動送信タイマーをリセット */
  const resetAutoSendTimer = useCallback(() => {
    if (autoSendTimerRef.current) {
      clearTimeout(autoSendTimerRef.current)
      autoSendTimerRef.current = null
    }
    if (!autoSendEnabledRef.current || isLoadingRef.current) return
    autoSendTimerRef.current = setTimeout(() => {
      const text = inputTextRef.current.trim()
      if (text) {
        const image = cameraCaptureRef.current?.captureFrame() ?? undefined
        onSendMessage(text, image)
        setInputText('')
      }
      autoSendTimerRef.current = null
    }, 3500)
  }, [onSendMessage])

  // 中間結果（話し続けている最中）でもタイマーリセット
  useEffect(() => {
    if (interimText && autoSendEnabledRef.current && !isLoadingRef.current) {
      resetAutoSendTimer()
    }
  }, [interimText, resetAutoSendTimer])

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

        {/* ローディングインジケーター */}
        {isLoading && <LoadingIndicator />}

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

      {/* 入力エリア */}
      <div className="border-t border-gray-200 dark:border-gray-700 p-2 sm:p-4">
        <CameraPreview ref={cameraCaptureRef} enabled={cameraEnabled} />
        <textarea
          value={inputText}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="メッセージを入力..."
          className="w-full resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 p-2 sm:p-3 text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={2}
          disabled={isLoading}
          data-testid="chat-input"
        />
        {/* 中間結果（認識中テキスト） */}
        {interimText && (
          <p className="text-xs text-gray-400 italic px-1 mt-0.5 mb-1 truncate">
            {interimText}
          </p>
        )}
        {/* STT エラー表示 */}
        {sttError && (
          <p className="text-xs text-red-500 px-1 mt-0.5 mb-1">
            {sttError}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1">
          {inputExtra}
          {/* マイクボタン（対応ブラウザのみ） */}
          {sttSupported && (
            <button
              onClick={toggleListening}
              className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
                sttStatus === 'listening'
                  ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
                  : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300'
              }`}
              title={sttStatus === 'listening' ? '音声認識を停止' : '音声入力'}
              data-testid="stt-mic-button"
            >
              {sttStatus === 'listening' ? (
                /* 停止アイコン */
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
              ) : (
                /* マイクアイコン */
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              )}
            </button>
          )}
          <button
            onClick={handleSendClick}
            disabled={!inputText.trim() || isLoading}
            className="flex-1 px-4 sm:px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors text-sm sm:text-base"
            data-testid="send-button"
          >
            送信
          </button>
        </div>
        <div className="flex items-center justify-between mt-1 sm:mt-2">
          {developerMode && (
            <div className="flex items-center gap-3">
              {sttSupported && (
                <label className="flex items-center gap-1.5 cursor-pointer select-none" data-testid="auto-send-toggle">
                  <span className="text-xs text-gray-500">🎤 音声自動送信</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoSendEnabled}
                    onClick={() => setAutoSendEnabled(!autoSendEnabled)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      autoSendEnabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                        autoSendEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                      }`}
                    />
                  </button>
                </label>
              )}
              <label className="flex items-center gap-1.5 cursor-pointer select-none" data-testid="camera-toggle">
                <span className="text-xs text-gray-500">📷 カメラ</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={cameraEnabled}
                  onClick={() => onToggleCamera(!cameraEnabled)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    cameraEnabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                      cameraEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                    }`}
                  />
                </button>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none" data-testid="tts-toggle">
                <span className="text-xs text-gray-500">🔊 自動読み上げ</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={ttsEnabled}
                  onClick={() => onToggleTts(!ttsEnabled)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    ttsEnabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                      ttsEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                    }`}
                  />
                </button>
              </label>
            </div>
          )}
          <p className="text-xs text-gray-500 hidden sm:block">
            Enter で送信、Shift+Enter で改行
          </p>
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
 * ローディングインジケーター コンポーネント
 */
function LoadingIndicator() {
  return (
    <div className="flex justify-start" data-testid="loading-indicator">
      <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
        <div className="flex space-x-2">
          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  )
}

