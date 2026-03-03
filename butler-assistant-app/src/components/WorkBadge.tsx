import { useState, useEffect, useMemo } from 'react'

interface WorkBadgeProps {
  active: boolean
  expiresAt: string
  /** コンパクト表示（ThemeList 用） */
  compact?: boolean
}

/**
 * 残り時間のテキストを計算
 */
function calcRemainingText(active: boolean, expiresAt: string): string {
  if (!active) return ''
  const remaining = new Date(expiresAt).getTime() - Date.now()
  if (remaining <= 0) return '終了'
  const minutes = Math.floor(remaining / 60_000)
  const seconds = Math.floor((remaining % 60_000) / 1000)
  return `残り${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * ワーク（MCP接続）状態バッジ
 *
 * アクティブ: 緑バッジ + 残り時間カウントダウン
 * 失効: グレーバッジ
 */
export function WorkBadge({ active, expiresAt, compact = false }: WorkBadgeProps) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setTick((t) => t + 1), 10_000)
    return () => clearInterval(timer)
  }, [active, expiresAt])

  // tick を依存に含めて10秒ごとに再計算
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const remainingText = useMemo(() => calcRemainingText(active, expiresAt), [active, expiresAt, tick])

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded ${
          active
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
        }`}
        data-testid="work-badge"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-green-500' : 'bg-gray-400'}`} />
        ワーク
      </span>
    )
  }

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
        active
          ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
          : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
      }`}
      data-testid="work-badge"
    >
      {/* ブリーフケースアイコン */}
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
      <span>
        {active ? `ワーク ${remainingText}` : 'ワーク 終了'}
      </span>
    </div>
  )
}
