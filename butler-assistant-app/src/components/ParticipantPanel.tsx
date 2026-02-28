import { useState } from 'react'

interface ParticipantPanelProps {
  displayName: string
  onUnfriend?: () => Promise<void>
}

/**
 * 参加者パネル コンポーネント
 *
 * チャット相手の情報を表示する右パネル。
 */
export function ParticipantPanel({ displayName, onUnfriend }: ParticipantPanelProps) {
  const initial = displayName.charAt(0).toUpperCase() || '?'
  const [isUnfriending, setIsUnfriending] = useState(false)

  /** フレンド解除ボタン押下 */
  const handleUnfriend = async () => {
    if (!onUnfriend) return
    const confirmed = window.confirm(`${displayName} さんとのフレンドを解除しますか？\n会話履歴もすべて削除されます。`)
    if (!confirmed) return

    setIsUnfriending(true)
    try {
      await onUnfriend()
    } finally {
      setIsUnfriending(false)
    }
  }

  return (
    <div className="flex flex-col items-center pt-12 px-6 h-full bg-gray-50 dark:bg-gray-900" data-testid="participant-panel">
      {/* アバタープレースホルダー */}
      <div className="w-20 h-20 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center mb-4">
        <span className="text-2xl font-bold text-blue-600 dark:text-blue-300">
          {initial}
        </span>
      </div>

      {/* 表示名 */}
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 text-center break-all">
        {displayName}
      </h3>

      <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
        フレンド
      </p>

      {/* フレンド解除ボタン */}
      {onUnfriend && (
        <button
          onClick={handleUnfriend}
          disabled={isUnfriending}
          className="mt-8 px-4 py-2 text-sm text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          data-testid="unfriend-button"
        >
          {isUnfriending ? '解除中...' : 'フレンドを解除'}
        </button>
      )}
    </div>
  )
}
