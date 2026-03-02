import { useState, useCallback } from 'react'

interface CreateThemeModalProps {
  isOpen: boolean
  onClose: () => void
  onCreate: (themeName: string) => Promise<void>
}

/**
 * テーマ作成モーダル
 */
export function CreateThemeModal({ isOpen, onClose, onCreate }: CreateThemeModalProps) {
  const [themeName, setThemeName] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const handleCreate = useCallback(async () => {
    if (!themeName.trim() || isCreating) return
    setIsCreating(true)
    try {
      await onCreate(themeName.trim())
      setThemeName('')
      onClose()
    } catch (error) {
      console.error('[CreateThemeModal] テーマ作成エラー:', error)
    } finally {
      setIsCreating(false)
    }
  }, [themeName, isCreating, onCreate, onClose])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      data-testid="create-theme-modal"
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            新しいテーマを作成
          </h3>
        </div>
        <div className="p-4">
          <input
            type="text"
            value={themeName}
            onChange={(e) => setThemeName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
            placeholder="テーマ名を入力..."
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
            data-testid="theme-name-input"
          />
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleCreate}
            disabled={!themeName.trim() || isCreating}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
            data-testid="create-theme-submit"
          >
            {isCreating ? '作成中...' : '作成'}
          </button>
        </div>
      </div>
    </div>
  )
}
