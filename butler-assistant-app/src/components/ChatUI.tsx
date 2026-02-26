import { useState, useRef, useEffect } from 'react'
import type { Message } from '@/types'

interface ChatUIProps {
  messages: Message[]
  isLoading: boolean
  onSendMessage: (text: string) => void
}

/**
 * チャットUI コンポーネント
 */
export function ChatUI({ messages, isLoading, onSendMessage }: ChatUIProps) {
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
        <p className="text-xs text-gray-500 mt-1 sm:mt-2 hidden sm:block">
          Enter で送信、Shift+Enter で改行
        </p>
      </div>
    </div>
  )
}

/**
 * メッセージバブル コンポーネント
 */
function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'

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
        <span className="text-[10px] sm:text-xs opacity-70 mt-1 block">
          {formatTime(message.timestamp)}
        </span>
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
