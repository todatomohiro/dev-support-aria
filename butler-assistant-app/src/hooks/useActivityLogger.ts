import { useEffect, useRef } from 'react'
import { useAppStore } from '@/stores/appStore'
import { getIdToken } from '@/auth'

/** バッチ送信間隔（15分） */
const FLUSH_INTERVAL_MS = 15 * 60 * 1000

/** イベントの throttle 間隔（1秒） */
const THROTTLE_MS = 1000

/**
 * 現在時刻を分単位（YYYY-MM-DDTHH:mm）に切り捨て
 */
function currentMinute(): string {
  const now = new Date()
  const y = now.getFullYear()
  const mo = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const h = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  return `${y}-${mo}-${d}T${h}:${mi}`
}

/**
 * 蓄積データをバックエンドへ送信
 */
async function flushMinutes(minutes: Set<string>, useBeacon = false): Promise<void> {
  if (minutes.size === 0) return

  const activeMinutes = Array.from(minutes)
  minutes.clear()

  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
  if (!apiBaseUrl) return

  try {
    const token = await getIdToken()
    if (!token) return

    const url = `${apiBaseUrl}/users/activity`
    const body = JSON.stringify({ activeMinutes })

    if (useBeacon) {
      // sendBeacon は Authorization ヘッダーを送れないため keepalive fetch を使用
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body,
        keepalive: true,
      }).catch(() => {})
    } else {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body,
      })
    }
  } catch {
    // fire-and-forget — 失敗してもメイン機能に影響させない
  }
}

/**
 * アクティビティロガー hook
 *
 * ユーザー操作を分単位で記録し、バックグラウンド移行時・15分間隔でバッチ送信する。
 * `activityLoggingEnabled` が false の場合は一切のリスナー登録・処理を行わない。
 */
export function useActivityLogger(): void {
  const enabled = useAppStore((s) => s.config.ui.activityLoggingEnabled)
  const minutesRef = useRef(new Set<string>())
  const lastRecordRef = useRef(0)

  useEffect(() => {
    if (!enabled) return

    const minutes = minutesRef.current

    /** throttle 付きで現在分を記録 */
    const recordActivity = () => {
      const now = Date.now()
      if (now - lastRecordRef.current < THROTTLE_MS) return
      lastRecordRef.current = now
      minutes.add(currentMinute())
    }

    /** visibilitychange — hidden 時にフラッシュ */
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushMinutes(minutes, true)
      }
    }

    // イベントリスナー登録（passive でパフォーマンス影響を最小化）
    const events = ['click', 'touchstart', 'keydown', 'scroll'] as const
    for (const ev of events) {
      document.addEventListener(ev, recordActivity, { passive: true })
    }
    document.addEventListener('visibilitychange', handleVisibility)

    // 定期フラッシュ
    const timer = setInterval(() => { flushMinutes(minutes) }, FLUSH_INTERVAL_MS)

    return () => {
      for (const ev of events) {
        document.removeEventListener(ev, recordActivity)
      }
      document.removeEventListener('visibilitychange', handleVisibility)
      clearInterval(timer)
      // クリーンアップ時にも送信試行
      flushMinutes(minutes, true)
    }
  }, [enabled])
}
