/** 曜日表示 */
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

/**
 * 同日判定
 * @param ts1 - タイムスタンプ1（ミリ秒）
 * @param ts2 - タイムスタンプ2（ミリ秒）
 */
export function isSameDay(ts1: number, ts2: number): boolean {
  const d1 = new Date(ts1)
  const d2 = new Date(ts2)
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  )
}

/**
 * 時刻フォーマット（HH:MM）
 * @param ts - タイムスタンプ（ミリ秒）
 */
export function formatTime(ts: number): string {
  const d = new Date(ts)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

/**
 * 相対タイムスタンプフォーマット（会話一覧用）
 *
 * - 今日: "HH:MM"
 * - 昨日: "昨日 HH:MM"
 * - 今年: "M月D日"
 * - 前年以前: "YYYY/M/D"
 *
 * @param ts - タイムスタンプ（ミリ秒）
 * @param now - 現在時刻（テスト用、デフォルト: Date.now()）
 */
export function formatRelativeTimestamp(ts: number, now: number = Date.now()): string {
  const date = new Date(ts)
  const nowDate = new Date(now)

  if (isSameDay(ts, now)) {
    return formatTime(ts)
  }

  // 昨日判定: now の前日
  const yesterday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - 1)
  if (isSameDay(ts, yesterday.getTime())) {
    return `昨日 ${formatTime(ts)}`
  }

  if (date.getFullYear() === nowDate.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`
  }

  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

/**
 * 日付セパレータ用フォーマット
 *
 * - 今日: "今日"
 * - 昨日: "昨日"
 * - 今年: "M月D日 (曜日)"
 * - 前年以前: "YYYY/M/D (曜日)"
 *
 * @param ts - タイムスタンプ（ミリ秒）
 * @param now - 現在時刻（テスト用、デフォルト: Date.now()）
 */
export function formatDateSeparator(ts: number, now: number = Date.now()): string {
  const date = new Date(ts)
  const nowDate = new Date(now)
  const weekday = WEEKDAYS[date.getDay()]

  if (isSameDay(ts, now)) {
    return '今日'
  }

  const yesterday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - 1)
  if (isSameDay(ts, yesterday.getTime())) {
    return '昨日'
  }

  if (date.getFullYear() === nowDate.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 (${weekday})`
  }

  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} (${weekday})`
}
