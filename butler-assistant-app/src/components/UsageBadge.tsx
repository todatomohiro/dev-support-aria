import { useAppStore } from '@/stores'

/**
 * 残回数バッジ（全プランで表示）
 *
 * チャット入力エリア付近に表示し、日次の残回数を示す。
 */
export function UsageBadge() {
  const usageInfo = useAppStore((s) => s.usageInfo)

  // 使用量情報がない場合は非表示
  if (!usageInfo) return null

  // 日次無制限（Platinum）の場合
  const isUnlimited = usageInfo.daily.limit < 0

  const { remaining } = usageInfo.daily
  const colorClass = isUnlimited
    ? 'text-green-500 dark:text-green-400'
    : remaining <= 0
      ? 'text-red-500 dark:text-red-400'
      : remaining <= 5
        ? 'text-amber-500 dark:text-amber-400'
        : 'text-gray-500 dark:text-gray-400'

  const monthlyText = usageInfo.monthly.limit < 0 ? '無制限' : `${usageInfo.monthly.used}/${usageInfo.monthly.limit} 回使用`
  const premiumText = usageInfo.plan !== 'free' ? ` | Premium: ${usageInfo.premiumMonthly.used}/${usageInfo.premiumMonthly.limit} 回` : ''

  return (
    <span
      className={`text-xs font-medium ${colorClass}`}
      data-testid="usage-badge"
      title={`月間: ${monthlyText}${premiumText}`}
    >
      {isUnlimited
        ? '無制限'
        : remaining <= 0
          ? '上限到達'
          : `残り ${remaining}回`}
    </span>
  )
}
