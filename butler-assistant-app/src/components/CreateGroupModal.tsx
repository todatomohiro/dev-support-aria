import { useState, useCallback } from 'react'
import { groupService } from '@/services/groupService'

interface CreateGroupModalProps {
  isOpen: boolean
  onClose: (created?: boolean) => void
}

/**
 * グループ作成モーダル
 *
 * グループ名を入力してグループを作成する。
 */
export function CreateGroupModal({ isOpen, onClose }: CreateGroupModalProps) {
  const [groupName, setGroupName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** グループを作成 */
  const handleCreate = useCallback(async () => {
    const name = groupName.trim()
    if (!name) return

    setIsCreating(true)
    setError(null)

    try {
      await groupService.createGroup(name)
      setGroupName('')
      onClose(true)
    } catch (err) {
      console.error('[CreateGroupModal] グループ作成エラー:', err)
      setError('グループの作成に失敗しました')
    } finally {
      setIsCreating(false)
    }
  }, [groupName, onClose])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      data-testid="create-group-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden"
        data-testid="create-group-panel"
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            グループを作成
          </h2>
          <button
            onClick={() => onClose()}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
            data-testid="create-group-close-button"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* コンテンツ */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              グループ名
            </label>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="グループ名を入力"
              className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              data-testid="group-name-input"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleCreate()
              }}
            />
          </div>

          <button
            onClick={handleCreate}
            disabled={!groupName.trim() || isCreating}
            className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            data-testid="create-group-submit"
          >
            {isCreating ? '作成中...' : '作成'}
          </button>
        </div>
      </div>
    </div>
  )
}
