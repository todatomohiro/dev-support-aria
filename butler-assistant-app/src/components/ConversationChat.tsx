import { useState, useRef, useEffect, useCallback } from 'react'
import { useMultiChatStore } from '@/stores/multiChatStore'
import { conversationService } from '@/services/conversationService'
import { useConversationPolling } from '@/hooks/useConversationPolling'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useAuthStore } from '@/auth/authStore'
import { wsService } from '@/services/wsService'
import { formatTime, formatDateSeparator, isSameDay } from '@/utils'

interface ConversationChatProps {
  conversationId: string
  otherDisplayName: string
  onBack: () => void
}

/**
 * 1対1チャットコンポーネント
 *
 * メッセージの表示・送信・ポーリングを行う。
 */
export function ConversationChat({ conversationId, otherDisplayName, onBack }: ConversationChatProps) {
  const [inputText, setInputText] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const activeMessages = useMultiChatStore((s) => s.activeMessages)
  const isSending = useMultiChatStore((s) => s.isSending)
  const isLoadingMessages = useMultiChatStore((s) => s.isLoadingMessages)
  const otherLastReadAt = useMultiChatStore((s) => s.otherLastReadAt)
  const setActiveMessages = useMultiChatStore((s) => s.setActiveMessages)
  const setSending = useMultiChatStore((s) => s.setSending)
  const setLastPollTimestamp = useMultiChatStore((s) => s.setLastPollTimestamp)
  const appendMessages = useMultiChatStore((s) => s.appendMessages)
  const setLoadingMessages = useMultiChatStore((s) => s.setLoadingMessages)
  const setOtherLastReadAt = useMultiChatStore((s) => s.setOtherLastReadAt)

  const currentUser = useAuthStore((s) => s.user)

  // WebSocket 接続 + ポーリングフォールバック
  useWebSocket(conversationId)
  const wsStatus = useMultiChatStore((s) => s.wsStatus)
  useConversationPolling(wsStatus === 'failed' ? conversationId : null)

  /** 初期メッセージを読み込み */
  const loadInitialMessages = useCallback(async () => {
    setLoadError(null)
    setLoadingMessages(true)
    try {
      const { messages, otherLastReadAt: serverOtherLastReadAt } = await conversationService.getMessages(conversationId)
      setActiveMessages(messages)
      setOtherLastReadAt(serverOtherLastReadAt ?? null)
      if (messages.length > 0) {
        const maxTs = Math.max(...messages.map((m) => m.timestamp))
        setLastPollTimestamp(maxTs)
        // 会話を開いた時点で既読を通知
        conversationService.markAsRead(conversationId, maxTs).catch(() => { /* 既読通知失敗は無視 */ })
      } else {
        setLastPollTimestamp(Date.now())
      }
    } catch (error) {
      console.error('[ConversationChat] メッセージの読み込みに失敗:', error)
      setLoadError('メッセージの読み込みに失敗しました')
    } finally {
      setLoadingMessages(false)
    }
  }, [conversationId, setActiveMessages, setLastPollTimestamp, setLoadingMessages, setOtherLastReadAt])

  // マウント時にメッセージを読み込み
  useEffect(() => {
    loadInitialMessages()
    return () => {
      setActiveMessages([])
      setLastPollTimestamp(null)
      setOtherLastReadAt(null)
    }
  }, [loadInitialMessages, setActiveMessages, setLastPollTimestamp, setOtherLastReadAt])

  // メッセージ追加時に自動スクロール + 新着メッセージを既読通知
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    // 他ユーザーからの新着メッセージがあれば既読を通知
    if (activeMessages.length > 0) {
      const lastMsg = activeMessages[activeMessages.length - 1]
      if (lastMsg.senderId !== currentUser?.userId) {
        conversationService.markAsRead(conversationId, lastMsg.timestamp).catch(() => { /* 既読通知失敗は無視 */ })
      }
    }
  }, [activeMessages, conversationId, currentUser?.userId])

  /** メッセージを送信 */
  const handleSend = useCallback(async () => {
    const text = inputText.trim()
    if (!text || isSending) return

    setSending(true)
    setInputText('')

    try {
      const senderName = currentUser?.displayName ?? currentUser?.email ?? ''
      const newMessage = await conversationService.sendMessage(conversationId, text, senderName)
      appendMessages([newMessage])
      setLastPollTimestamp(newMessage.timestamp)
    } catch (error) {
      console.error('[ConversationChat] メッセージ送信に失敗:', error)
      setInputText(text) // 失敗時は入力を復元
    } finally {
      setSending(false)
    }
  }, [inputText, isSending, conversationId, currentUser, setSending, appendMessages, setLastPollTimestamp])

  /** Enter で送信、Shift+Enter で改行 */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900" data-testid="conversation-chat">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <button
          onClick={onBack}
          className="p-2 -ml-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 transition-colors"
          data-testid="chat-back-button"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        {/* モバイルではアバター + 名前を表示 */}
        <div className="flex items-center gap-2.5 min-w-0 md:hidden" data-testid="mobile-header-info">
          <div className="shrink-0 w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
            <span className="text-xs font-medium text-blue-600 dark:text-blue-300">
              {otherDisplayName.charAt(0).toUpperCase()}
            </span>
          </div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
            {otherDisplayName}
          </h3>
        </div>
        <h3 className="hidden md:block text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
          {otherDisplayName}
        </h3>
      </div>

      {/* WebSocket ステータスバー */}
      {wsStatus === 'connecting' && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-yellow-50 dark:bg-yellow-900/30 border-b border-yellow-200 dark:border-yellow-800 shrink-0" data-testid="ws-status-bar">
          <svg className="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-400 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-xs text-yellow-700 dark:text-yellow-300">接続中...</span>
        </div>
      )}
      {wsStatus === 'failed' && (
        <div className="flex items-center justify-between px-4 py-1.5 bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 shrink-0" data-testid="ws-status-bar">
          <span className="text-xs text-red-700 dark:text-red-300">リアルタイム接続に失敗しました。ポーリングモードで動作中</span>
          <button
            onClick={() => wsService.reconnect()}
            className="shrink-0 ml-2 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700 rounded hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
            data-testid="ws-reconnect-button"
          >
            再接続
          </button>
        </div>
      )}

      {/* メッセージエリア */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
        {/* ローディング中 */}
        {isLoadingMessages && activeMessages.length === 0 && (
          <div className="flex justify-start" data-testid="messages-loading">
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
              <div className="flex space-x-2">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {/* エラー状態 */}
        {loadError && activeMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center" data-testid="messages-error">
            <svg className="w-10 h-10 mb-3 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{loadError}</p>
            <button
              onClick={loadInitialMessages}
              className="px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
              data-testid="messages-retry"
            >
              再試行
            </button>
          </div>
        )}

        {/* メッセージ一覧 */}
        {activeMessages.map((message, index) => {
          const isOwn = message.senderId === currentUser?.userId
          const isSystem = message.type === 'system'

          // 日付セパレータ: 前のメッセージと日付が異なる場合に表示
          const prevMessage = index > 0 ? activeMessages[index - 1] : null
          const showDateSeparator = !prevMessage || !isSameDay(prevMessage.timestamp, message.timestamp)

          return (
            <div key={message.id}>
              {showDateSeparator && (
                <div className="flex items-center justify-center my-3" data-testid="date-separator">
                  <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
                  <span className="px-3 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                    {formatDateSeparator(message.timestamp)}
                  </span>
                  <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
                </div>
              )}

              {isSystem ? (
                <div className="flex justify-center" data-testid="system-message">
                  <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-full">
                    {message.content}
                  </span>
                </div>
              ) : (
                <div
                  className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
                  data-testid="chat-message"
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 ${
                      isOwn
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                    }`}
                  >
                    {!isOwn && (
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">
                        {message.senderName}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                    <div className={`flex items-center gap-1 mt-1 ${isOwn ? 'justify-end' : ''}`}>
                      <span className={`text-[10px] ${isOwn ? 'text-blue-200' : 'text-gray-400 dark:text-gray-500'}`}>
                        {formatTime(message.timestamp)}
                      </span>
                      {isOwn && otherLastReadAt !== null && message.timestamp <= otherLastReadAt && (
                        <span className="text-[10px] text-blue-200" data-testid="read-receipt">既読</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* 入力エリア */}
      <div className="border-t border-gray-200 dark:border-gray-700 p-3 sm:p-4 shrink-0" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="flex items-end gap-2">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="メッセージを入力..."
            className="flex-1 resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={2}
            disabled={isSending}
            data-testid="multi-chat-input"
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim() || isSending}
            className="shrink-0 px-4 py-2.5 min-w-[56px] min-h-[44px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors text-sm"
            data-testid="multi-chat-send-button"
          >
            {isSending ? '送信中...' : '送信'}
          </button>
        </div>
      </div>
    </div>
  )
}
