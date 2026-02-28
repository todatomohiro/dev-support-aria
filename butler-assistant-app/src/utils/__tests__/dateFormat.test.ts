import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { isSameDay, formatTime, formatRelativeTimestamp, formatDateSeparator } from '../dateFormat'

describe('isSameDay', () => {
  it('同じ日付の場合 true を返す', () => {
    const ts1 = new Date(2026, 1, 28, 9, 0).getTime()
    const ts2 = new Date(2026, 1, 28, 23, 59).getTime()
    expect(isSameDay(ts1, ts2)).toBe(true)
  })

  it('異なる日付の場合 false を返す', () => {
    const ts1 = new Date(2026, 1, 27, 23, 59).getTime()
    const ts2 = new Date(2026, 1, 28, 0, 0).getTime()
    expect(isSameDay(ts1, ts2)).toBe(false)
  })

  it('同じタイムスタンプの場合 true を返す', () => {
    const ts = Date.now()
    expect(isSameDay(ts, ts)).toBe(true)
  })

  it('Feature: butler-assistant-app, Property 1: 同一タイムスタンプは常に同日', () => {
    const min = new Date(2000, 0, 1).getTime()
    const max = new Date(2030, 11, 31).getTime()
    fc.assert(
      fc.property(
        fc.integer({ min, max }),
        (ts) => {
          expect(isSameDay(ts, ts)).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })
})

describe('formatTime', () => {
  it('0時0分を "00:00" にフォーマットする', () => {
    const ts = new Date(2026, 1, 28, 0, 0).getTime()
    expect(formatTime(ts)).toBe('00:00')
  })

  it('9時5分を "09:05" にフォーマットする', () => {
    const ts = new Date(2026, 1, 28, 9, 5).getTime()
    expect(formatTime(ts)).toBe('09:05')
  })

  it('23時59分を "23:59" にフォーマットする', () => {
    const ts = new Date(2026, 1, 28, 23, 59).getTime()
    expect(formatTime(ts)).toBe('23:59')
  })

  it('Feature: butler-assistant-app, Property 2: HH:MM 形式を返す', () => {
    const min = new Date(2000, 0, 1).getTime()
    const max = new Date(2030, 11, 31).getTime()
    fc.assert(
      fc.property(
        fc.integer({ min, max }),
        (ts) => {
          const result = formatTime(ts)
          expect(result).toMatch(/^\d{2}:\d{2}$/)
        }
      ),
      { numRuns: 100 }
    )
  })
})

describe('formatRelativeTimestamp', () => {
  const now = new Date(2026, 1, 28, 15, 30).getTime() // 2026/2/28 15:30

  it('今日のタイムスタンプは時刻を返す', () => {
    const ts = new Date(2026, 1, 28, 10, 15).getTime()
    expect(formatRelativeTimestamp(ts, now)).toBe('10:15')
  })

  it('昨日のタイムスタンプは「昨日 HH:MM」を返す', () => {
    const ts = new Date(2026, 1, 27, 20, 0).getTime()
    expect(formatRelativeTimestamp(ts, now)).toBe('昨日 20:00')
  })

  it('今年の古い日付は「M月D日」を返す', () => {
    const ts = new Date(2026, 0, 15).getTime()
    expect(formatRelativeTimestamp(ts, now)).toBe('1月15日')
  })

  it('前年の日付は「YYYY/M/D」を返す', () => {
    const ts = new Date(2025, 11, 25).getTime()
    expect(formatRelativeTimestamp(ts, now)).toBe('2025/12/25')
  })

  it('月初の昨日判定（3月1日 → 2月28日）', () => {
    const nowMar1 = new Date(2026, 2, 1, 10, 0).getTime()
    const ts = new Date(2026, 1, 28, 18, 0).getTime()
    expect(formatRelativeTimestamp(ts, nowMar1)).toBe('昨日 18:00')
  })

  it('Feature: butler-assistant-app, Property 3: 同日は HH:MM 形式を返す', () => {
    const dayStart = new Date(2026, 1, 28, 0, 0).getTime()
    const dayEnd = new Date(2026, 1, 28, 23, 59, 59, 999).getTime()
    fc.assert(
      fc.property(
        fc.integer({ min: dayStart, max: dayEnd }),
        (ts) => {
          const result = formatRelativeTimestamp(ts, now)
          expect(result).toMatch(/^\d{2}:\d{2}$/)
        }
      ),
      { numRuns: 100 }
    )
  })
})

describe('formatDateSeparator', () => {
  const now = new Date(2026, 1, 28, 15, 30).getTime()

  it('今日のタイムスタンプは「今日」を返す', () => {
    const ts = new Date(2026, 1, 28, 10, 0).getTime()
    expect(formatDateSeparator(ts, now)).toBe('今日')
  })

  it('昨日のタイムスタンプは「昨日」を返す', () => {
    const ts = new Date(2026, 1, 27, 10, 0).getTime()
    expect(formatDateSeparator(ts, now)).toBe('昨日')
  })

  it('今年の別の日は「M月D日 (曜日)」を返す', () => {
    const ts = new Date(2026, 0, 5).getTime() // 2026/1/5 = 月曜
    expect(formatDateSeparator(ts, now)).toBe('1月5日 (月)')
  })

  it('前年の日付は「YYYY/M/D (曜日)」を返す', () => {
    const ts = new Date(2025, 11, 25).getTime() // 2025/12/25 = 木曜
    expect(formatDateSeparator(ts, now)).toBe('2025/12/25 (木)')
  })

  it('曜日が正しく表示される（日〜土）', () => {
    // 2026/3/1 は日曜
    const sunday = new Date(2026, 2, 1).getTime()
    expect(formatDateSeparator(sunday, now)).toBe('3月1日 (日)')

    // 2026/3/7 は土曜
    const saturday = new Date(2026, 2, 7).getTime()
    expect(formatDateSeparator(saturday, now)).toBe('3月7日 (土)')
  })

  it('Feature: butler-assistant-app, Property 4: 同日は常に「今日」を返す', () => {
    const dayStart = new Date(2026, 1, 28, 0, 0).getTime()
    const dayEnd = new Date(2026, 1, 28, 23, 59, 59, 999).getTime()
    fc.assert(
      fc.property(
        fc.integer({ min: dayStart, max: dayEnd }),
        (ts) => {
          expect(formatDateSeparator(ts, now)).toBe('今日')
        }
      ),
      { numRuns: 100 }
    )
  })
})
