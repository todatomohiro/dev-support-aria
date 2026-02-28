import { useState, useRef, useEffect, useCallback } from 'react'
import type { Message } from '@/types'
import { ttsService } from '@/services/ttsService'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'

interface ChatUIProps {
  messages: Message[]
  isLoading: boolean
  onSendMessage: (text: string) => void
  ttsEnabled: boolean
  onToggleTts: (enabled: boolean) => void
  developerMode?: boolean
}

/**
 * チャットUI コンポーネント
 */
export function ChatUI({ messages, isLoading, onSendMessage, ttsEnabled, onToggleTts, developerMode = false }: ChatUIProps) {
  const [inputText, setInputText] = useState('')
  const [autoSendEnabled, setAutoSendEnabled] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const autoSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputTextRef = useRef('')
  const autoSendEnabledRef = useRef(false)
  const isLoadingRef = useRef(false)

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
        onSendMessage(text)
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

  // 新しいメッセージ追加時に自動スクロール
  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value)
  }

  const handleSendClick = () => {
    if (inputText.trim() && !isLoading) {
      if (autoSendTimerRef.current) {
        clearTimeout(autoSendTimerRef.current)
        autoSendTimerRef.current = null
      }
      onSendMessage(inputText.trim())
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
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      {/* メッセージ履歴エリア */}
      <div className="flex-1 overflow-y-auto p-2 sm:p-4 space-y-2 sm:space-y-4">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} developerMode={developerMode} />
        ))}

        {/* ローディングインジケーター */}
        {isLoading && <LoadingIndicator />}

        {/* スクロール用のアンカー */}
        <div ref={messagesEndRef} />
      </div>

      {/* 入力エリア */}
      <div className="border-t border-gray-200 dark:border-gray-700 p-2 sm:p-4">
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

  const handleSpeak = useCallback(async () => {
    setIsSpeaking(true)
    try {
      await ttsService.synthesizeAndPlay(message.content)
    } finally {
      setIsSpeaking(false)
    }
  }, [message.content])

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
        <p className="whitespace-pre-wrap text-sm sm:text-base">{message.content}</p>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] sm:text-xs opacity-70">
            {formatTime(message.timestamp)}
          </span>
          <div className="flex items-center">
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
                disabled={isSpeaking}
                className="ml-2 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 opacity-60 hover:opacity-100 transition-opacity disabled:opacity-30"
                title="読み上げ"
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

/**
 * タイムスタンプをフォーマット
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  })
}
