import { useState } from 'react'
import type { ConversationSummary } from '@/types'
import { formatRelativeTimestamp } from '@/utils'
import { FriendCodeModal } from './FriendCodeModal'

interface ConversationListProps {
  conversations: ConversationSummary[]
  onSelectConversation: (conversationId: string) => void
  onRefresh: () => void
  isLoading?: boolean
  error?: string | null
  unreadCounts?: Record<string, number>
}

/**
 * 会話一覧コンポーネント
 *
 * 会話リストを表示し、会話の選択やフレンド追加を行う。
 */
export function ConversationList({
  conversations,
  onSelectConversation,
  onRefresh,
  isLoading = false,
  error = null,
  unreadCounts = {},
}: ConversationListProps) {
  const [isFriendModalOpen, setIsFriendModalOpen] = useState(false)

  /** フレンドモーダルを閉じた後に会話一覧を更新 */
  const handleFriendModalClose = () => {
    setIsFriendModalOpen(false)
    onRefresh()
  }

  /** 未読カウントをフォーマット */
  const formatUnreadCount = (count: number): string => {
    return count > 99 ? '99+' : String(count)
  }

  // updatedAt 降順でソート
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="flex flex-col flex-1 bg-white dark:bg-gray-900" data-testid="conversation-list">
      {/* ヘッダー */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          チャット
        </h2>
        <button
          onClick={() => setIsFriendModalOpen(true)}
          className="px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
          data-testid="add-friend-button"
        >
          フレンドを追加
        </button>
      </div>

      {/* 会話リスト */}
      <div className="flex-1 overflow-y-auto">
        {/* ローディング中 */}
        {isLoading && sorted.length === 0 ? (
          <div className="p-4 space-y-3" data-testid="conversation-list-loading">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 animate-pulse">
                <div className="shrink-0 w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          /* エラー状態 */
          <div className="flex flex-col items-center justify-center h-full px-6 py-12 text-center" data-testid="conversation-list-error">
            <svg className="w-10 h-10 mb-3 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{error}</p>
            <button
              onClick={onRefresh}
              className="px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
              data-testid="conversation-list-retry"
            >
              再試行
            </button>
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-6 py-12 text-center">
            <svg className="w-12 h-12 mb-4 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
              まだ会話がありません
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              フレンドを追加して会話を始めましょう
            </p>
          </div>
        ) : (
          <ul>
            {sorted.map((conversation) => {
              const unread = unreadCounts[conversation.conversationId] ?? 0
              return (
                <li key={conversation.conversationId}>
                  <button
                    onClick={() => onSelectConversation(conversation.conversationId)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 sm:py-3 hover:bg-gray-50 dark:hover:bg-gray-800 active:bg-gray-100 dark:active:bg-gray-700 transition-colors text-left border-b border-gray-100 dark:border-gray-800"
                    data-testid={`conversation-row-${conversation.conversationId}`}
                  >
                    {/* アバタープレースホルダー */}
                    <div className="shrink-0 w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
                      <span className="text-sm font-medium text-blue-600 dark:text-blue-300">
                        {conversation.otherDisplayName.charAt(0).toUpperCase()}
                      </span>
                    </div>

                    {/* テキスト */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className={`text-sm truncate ${unread > 0 ? 'font-bold text-gray-900 dark:text-gray-100' : 'font-medium text-gray-900 dark:text-gray-100'}`}>
                          {conversation.otherDisplayName}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 ml-2">
                          {formatRelativeTimestamp(conversation.updatedAt)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <p className={`text-xs truncate ${unread > 0 ? 'text-gray-700 dark:text-gray-300 font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
                          {conversation.lastMessage}
                        </p>
                        {unread > 0 && (
                          <span
                            className="shrink-0 ml-2 min-w-[20px] h-5 flex items-center justify-center px-1.5 text-[11px] font-bold text-white bg-red-500 rounded-full"
                            data-testid={`unread-badge-${conversation.conversationId}`}
                          >
                            {formatUnreadCount(unread)}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* フレンドコードモーダル */}
      <FriendCodeModal
        isOpen={isFriendModalOpen}
        onClose={handleFriendModalClose}
      />
    </div>
  )
}
