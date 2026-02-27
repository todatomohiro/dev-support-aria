import { useState, useRef, useEffect, useCallback } from 'react'
import type { Message } from '@/types'
import { ttsService } from '@/services/ttsService'

interface ChatUIProps {
  messages: Message[]
  isLoading: boolean
  onSendMessage: (text: string) => void
  ttsEnabled: boolean
  onToggleTts: (enabled: boolean) => void
}

/**
 * チャットUI コンポーネント
 */
export function ChatUI({ messages, isLoading, onSendMessage, ttsEnabled, onToggleTts }: ChatUIProps) {
  const [inputText, setInputText] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

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
      onSendMessage(inputText.trim())
      setInputText('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
          <MessageBubble key={message.id} message={message} />
        ))}

        {/* ローディングインジケーター */}
        {isLoading && <LoadingIndicator />}

        {/* スクロール用のアンカー */}
        <div ref={messagesEndRef} />
      </div>

      {/* 入力エリア */}
      <div className="border-t border-gray-200 dark:border-gray-700 p-2 sm:p-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <textarea
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="メッセージを入力..."
            className="flex-1 resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 p-2 sm:p-3 text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={2}
            disabled={isLoading}
            data-testid="chat-input"
          />
          <button
            onClick={handleSendClick}
            disabled={!inputText.trim() || isLoading}
            className="px-4 sm:px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors text-sm sm:text-base"
            data-testid="send-button"
          >
            送信
          </button>
        </div>
        <div className="flex items-center justify-between mt-1 sm:mt-2">
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
function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  const [isSpeaking, setIsSpeaking] = useState(false)

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
