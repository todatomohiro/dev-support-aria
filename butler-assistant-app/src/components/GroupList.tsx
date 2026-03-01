import { useState } from 'react'
import type { GroupSummary } from '@/types'
import { formatRelativeTimestamp } from '@/utils'
import { CreateGroupModal } from './CreateGroupModal'

interface GroupListProps {
  groups: GroupSummary[]
  onSelectGroup: (groupId: string) => void
  onRefresh: () => void
  isLoading?: boolean
  error?: string | null
  unreadCounts?: Record<string, number>
  activeGroupId?: string
}

/**
 * グループ一覧コンポーネント
 *
 * グループリストを表示し、グループの選択を行う。
 */
export function GroupList({
  groups,
  onSelectGroup,
  onRefresh,
  isLoading = false,
  error = null,
  unreadCounts = {},
  activeGroupId,
}: GroupListProps) {
  const [isCreateGroupModalOpen, setIsCreateGroupModalOpen] = useState(false)

  /** グループ作成モーダルを閉じた後にリフレッシュ */
  const handleCreateGroupClose = (created?: boolean) => {
    setIsCreateGroupModalOpen(false)
    if (created) onRefresh()
  }

  /** 未読カウントをフォーマット */
  const formatUnreadCount = (count: number): string => {
    return count > 99 ? '99+' : String(count)
  }

  // updatedAt 降順でソート
  const sorted = [...groups].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900" data-testid="group-list">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          グループ ({groups.length})
        </h2>
        <button
          onClick={() => setIsCreateGroupModalOpen(true)}
          className="px-2.5 py-1 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          data-testid="create-group-button"
        >
          作成
        </button>
      </div>

      {/* グループリスト */}
      <div className="flex-1 overflow-y-auto">
        {/* ローディング中 */}
        {isLoading && sorted.length === 0 ? (
          <div className="p-4 space-y-3" data-testid="group-list-loading">
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
          <div className="flex flex-col items-center justify-center h-full px-6 py-12 text-center" data-testid="group-list-error">
            <svg className="w-10 h-10 mb-3 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{error}</p>
            <button
              onClick={onRefresh}
              className="px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
              data-testid="group-list-retry"
            >
              再試行
            </button>
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-6 py-12 text-center">
            <svg className="w-12 h-12 mb-4 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
              まだグループがありません
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              グループを作成してチャットを始めましょう
            </p>
          </div>
        ) : (
          <ul>
            {sorted.map((group) => {
              const unread = unreadCounts[group.groupId] ?? 0
              const isActive = group.groupId === activeGroupId
              return (
                <li key={group.groupId}>
                  <button
                    onClick={() => onSelectGroup(group.groupId)}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 sm:py-3 hover:bg-gray-50 dark:hover:bg-gray-800 active:bg-gray-100 dark:active:bg-gray-700 transition-colors text-left border-b border-gray-100 dark:border-gray-800 ${isActive ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                    data-testid={`group-row-${group.groupId}`}
                  >
                    {/* アバタープレースホルダー */}
                    <div className="shrink-0 w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center">
                      <span className="text-sm font-medium text-purple-600 dark:text-purple-300">
                        {group.groupName.charAt(0).toUpperCase()}
                      </span>
                    </div>

                    {/* テキスト */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className={`text-sm truncate ${unread > 0 ? 'font-bold text-gray-900 dark:text-gray-100' : 'font-medium text-gray-900 dark:text-gray-100'}`}>
                          {group.groupName}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 ml-2">
                          {formatRelativeTimestamp(group.updatedAt)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <p className={`text-xs truncate ${unread > 0 ? 'text-gray-700 dark:text-gray-300 font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
                          {group.lastMessage}
                        </p>
                        {unread > 0 && (
                          <span
                            className="shrink-0 ml-2 min-w-[20px] h-5 flex items-center justify-center px-1.5 text-[11px] font-bold text-white bg-red-500 rounded-full"
                            data-testid={`unread-badge-${group.groupId}`}
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

      {/* グループ作成モーダル */}
      <CreateGroupModal
        isOpen={isCreateGroupModalOpen}
        onClose={handleCreateGroupClose}
      />
    </div>
  )
}
