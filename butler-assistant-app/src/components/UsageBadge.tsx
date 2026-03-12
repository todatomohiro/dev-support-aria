import { useAppStore } from '@/stores'

/**
 * 残回数バッジ（無料プランのみ表示）
 *
 * チャット入力エリア付近に表示し、日次の残回数を示す。
 */
export function UsageBadge() {
  const usageInfo = useAppStore((s) => s.usageInfo)

  // 使用量情報がない or 有料プランの場合は非表示
  if (!usageInfo || usageInfo.plan === 'paid') return null

  const { remaining } = usageInfo.daily
  const colorClass =
    remaining <= 0
      ? 'text-red-500 dark:text-red-400'
      : remaining <= 5
        ? 'text-amber-500 dark:text-amber-400'
        : 'text-gray-500 dark:text-gray-400'

  return (
    <span
      className={`text-xs font-medium ${colorClass}`}
      data-testid="usage-badge"
      title={`月間: ${usageInfo.monthly.used}/${usageInfo.monthly.limit} 回使用`}
    >
      {remaining <= 0
        ? '上限到達'
        : `残り ${remaining}回`}
    </span>
  )
}
