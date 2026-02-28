import { useState } from 'react'
import type { FriendLink } from '@/types'
import { friendService } from '@/services/friendService'
import { UserCodeModal } from './UserCodeModal'

interface FriendListProps {
  friends: FriendLink[]
  onRefresh: () => void
  isLoading?: boolean
}

/**
 * フレンド一覧コンポーネント
 *
 * フレンドリストを表示し、フレンド追加・解除を行う。
 */
export function FriendList({
  friends,
  onRefresh,
  isLoading = false,
}: FriendListProps) {
  const [isUserCodeModalOpen, setIsUserCodeModalOpen] = useState(false)
  const [unfriendingId, setUnfriendingId] = useState<string | null>(null)

  /** ユーザーコードモーダルを閉じた後にリフレッシュ */
  const handleUserCodeModalClose = () => {
    setIsUserCodeModalOpen(false)
    onRefresh()
  }

  /** フレンドを解除 */
  const handleUnfriend = async (friendUserId: string) => {
    const confirmed = window.confirm('このフレンドを解除しますか？')
    if (!confirmed) return

    setUnfriendingId(friendUserId)
    try {
      await friendService.unfriend(friendUserId)
      onRefresh()
    } catch (error) {
      console.error('[FriendList] フレンド解除エラー:', error)
    } finally {
      setUnfriendingId(null)
    }
  }

  // displayName 昇順でソート
  const sorted = [...friends].sort((a, b) => a.displayName.localeCompare(b.displayName))

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900" data-testid="friend-list">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          フレンド ({friends.length})
        </h2>
        <button
          onClick={() => setIsUserCodeModalOpen(true)}
          className="px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
          data-testid="add-friend-button"
        >
          追加
        </button>
      </div>

      {/* フレンドリスト */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && sorted.length === 0 ? (
          <div className="p-4 space-y-3" data-testid="friend-list-loading">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-2.5 animate-pulse">
                <div className="shrink-0 w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700" />
                <div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 py-8 text-center">
            <svg className="w-10 h-10 mb-3 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              フレンドがいません
            </p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              ユーザーコードで追加しましょう
            </p>
          </div>
        ) : (
          <ul>
            {sorted.map((friend) => (
              <li key={friend.friendUserId}>
                <div
                  className="flex items-center gap-2.5 px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 group"
                  data-testid={`friend-row-${friend.friendUserId}`}
                >
                  {/* アバター */}
                  <div className="shrink-0 w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
                    <span className="text-xs font-medium text-blue-600 dark:text-blue-300">
                      {friend.displayName.charAt(0).toUpperCase()}
                    </span>
                  </div>

                  {/* 名前 */}
                  <span className="flex-1 text-sm text-gray-900 dark:text-gray-100 truncate">
                    {friend.displayName}
                  </span>

                  {/* 解除ボタン（ホバー時のみ表示） */}
                  <button
                    onClick={() => handleUnfriend(friend.friendUserId)}
                    disabled={unfriendingId === friend.friendUserId}
                    className="shrink-0 opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 transition-all disabled:opacity-50"
                    title="フレンド解除"
                    data-testid={`unfriend-${friend.friendUserId}`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ユーザーコードモーダル */}
      <UserCodeModal
        isOpen={isUserCodeModalOpen}
        onClose={handleUserCodeModalClose}
      />
    </div>
  )
}
