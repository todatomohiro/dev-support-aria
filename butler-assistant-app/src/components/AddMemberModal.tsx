import { useState, useEffect, useCallback } from 'react'
import { groupService } from '@/services/groupService'
import { friendService } from '@/services/friendService'
import type { FriendLink } from '@/types'

interface AddMemberModalProps {
  isOpen: boolean
  groupId: string
  onClose: (added?: boolean) => void
}

/**
 * メンバー追加モーダル
 *
 * フレンドから選択、またはユーザーコードで追加する。
 */
export function AddMemberModal({ isOpen, groupId, onClose }: AddMemberModalProps) {
  const [friends, setFriends] = useState<FriendLink[]>([])
  const [userCode, setUserCode] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // フレンド一覧を取得
  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setSuccessMessage(null)
    setUserCode('')
    friendService.listFriends()
      .then(setFriends)
      .catch(() => { /* 失敗時は空リスト */ })
  }, [isOpen])

  /** フレンドを追加 */
  const handleAddFriend = useCallback(async (friendUserId: string) => {
    setIsAdding(true)
    setError(null)
    try {
      const { nickname } = await groupService.addMember(groupId, { userId: friendUserId })
      setSuccessMessage(`${nickname} を追加しました`)
      setTimeout(() => onClose(true), 1000)
    } catch (err) {
      console.error('[AddMemberModal] メンバー追加エラー:', err)
      setError('メンバーの追加に失敗しました')
    } finally {
      setIsAdding(false)
    }
  }, [groupId, onClose])

  /** ユーザーコードで追加 */
  const handleAddByCode = useCallback(async () => {
    const code = userCode.trim()
    if (!code) return

    setIsAdding(true)
    setError(null)
    try {
      const { nickname } = await groupService.addMember(groupId, { userCode: code })
      setSuccessMessage(`${nickname} を追加しました`)
      setUserCode('')
      setTimeout(() => onClose(true), 1000)
    } catch (err) {
      console.error('[AddMemberModal] メンバー追加エラー:', err)
      setError('メンバーの追加に失敗しました。コードを確認してください。')
    } finally {
      setIsAdding(false)
    }
  }, [userCode, groupId, onClose])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      data-testid="add-member-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden"
        data-testid="add-member-panel"
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            メンバーを追加
          </h2>
          <button
            onClick={() => onClose()}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
            data-testid="add-member-close-button"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* コンテンツ */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[60vh]">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {successMessage && (
            <div className="p-3 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg">
              <p className="text-sm text-green-600 dark:text-green-400">{successMessage}</p>
            </div>
          )}

          {/* フレンドから追加 */}
          {friends.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                フレンドから追加
              </h3>
              <ul className="space-y-1">
                {friends.map((friend) => (
                  <li key={friend.friendUserId}>
                    <button
                      onClick={() => handleAddFriend(friend.friendUserId)}
                      disabled={isAdding}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors text-left"
                      data-testid={`add-friend-${friend.friendUserId}`}
                    >
                      <div className="shrink-0 w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
                        <span className="text-xs font-medium text-blue-600 dark:text-blue-300">
                          {friend.displayName.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <span className="text-sm text-gray-900 dark:text-gray-100">
                        {friend.displayName}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 区切り線 */}
          {friends.length > 0 && (
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
              <span className="text-xs text-gray-400 dark:text-gray-500">または</span>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
            </div>
          )}

          {/* ユーザーコードで追加 */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              ユーザーコードで追加
            </h3>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={userCode}
                onChange={(e) => setUserCode(e.target.value)}
                placeholder="ユーザーコードを入力"
                className="flex-1 px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                data-testid="user-code-input"
              />
              <button
                onClick={handleAddByCode}
                disabled={!userCode.trim() || isAdding}
                className="shrink-0 px-4 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                data-testid="add-by-code-button"
              >
                {isAdding ? '追加中...' : '追加'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
