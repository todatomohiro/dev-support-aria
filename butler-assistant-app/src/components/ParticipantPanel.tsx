interface ParticipantPanelProps {
  displayName: string
}

/**
 * 参加者パネル コンポーネント
 *
 * チャット相手の情報を表示する右パネル。
 */
export function ParticipantPanel({ displayName }: ParticipantPanelProps) {
  const initial = displayName.charAt(0).toUpperCase() || '?'

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
    </div>
  )
}
