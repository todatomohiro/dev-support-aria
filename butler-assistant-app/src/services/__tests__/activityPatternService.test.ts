import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ActivityPatternServiceImpl } from '../activityPatternService'
import type { ActivityPattern } from '../activityPatternService'

const PATTERN_CACHE_KEY = 'butler-activity-pattern'

/** テスト用のアクティビティパターン（平日3セッション、休日2セッション） */
function createTestPattern(overrides?: Partial<ActivityPattern>): ActivityPattern {
  return {
    weekday: [
      { from: '08:30', to: '09:00', confidence: 0.85 },
      { from: '13:00', to: '13:30', confidence: 0.7 },
      { from: '19:30', to: '20:00', confidence: 0.4 },
    ],
    weekend: [
      { from: '09:30', to: '10:00', confidence: 0.6 },
      { from: '14:00', to: '14:30', confidence: 0.5 },
    ],
    analyzedDays: 14,
    activeDays: 10,
    updatedAt: '2026-03-10T00:00:00Z',
    ...overrides,
  }
}

/** キャッシュにパターンをセット */
function setCachedPattern(pattern: ActivityPattern, cachedAt?: number) {
  localStorage.setItem(PATTERN_CACHE_KEY, JSON.stringify({
    pattern,
    cachedAt: cachedAt ?? Date.now(),
  }))
}

describe('ActivityPatternServiceImpl', () => {
  let service: ActivityPatternServiceImpl

  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('hasPattern', () => {
    it('キャッシュがない場合は false', () => {
      service = new ActivityPatternServiceImpl()
      expect(service.hasPattern()).toBe(false)
    })

    it('activeDays が 0 の場合は false', () => {
      setCachedPattern(createTestPattern({ activeDays: 0 }))
      service = new ActivityPatternServiceImpl()
      expect(service.hasPattern()).toBe(false)
    })

    it('有効なパターンがキャッシュにある場合は true', () => {
      setCachedPattern(createTestPattern())
      service = new ActivityPatternServiceImpl()
      expect(service.hasPattern()).toBe(true)
    })
  })

  describe('isInBriefingWindow', () => {
    beforeEach(() => {
      setCachedPattern(createTestPattern())
      service = new ActivityPatternServiceImpl()
    })

    it('平日 8:45 はウィンドウ内（08:30〜09:00）', () => {
      // 月曜日 8:45
      const date = new Date(2026, 2, 9, 8, 45)  // 2026-03-09 (月)
      vi.setSystemTime(date)
      expect(service.isInBriefingWindow(date)).toBe(true)
    })

    it('平日 8:29 はウィンドウ外', () => {
      const date = new Date(2026, 2, 9, 8, 29)
      vi.setSystemTime(date)
      expect(service.isInBriefingWindow(date)).toBe(false)
    })

    it('平日 9:01 はウィンドウ外（09:00を超過）', () => {
      const date = new Date(2026, 2, 9, 9, 1)
      vi.setSystemTime(date)
      expect(service.isInBriefingWindow(date)).toBe(false)
    })

    it('平日 13:15 はウィンドウ内（13:00〜13:30）', () => {
      const date = new Date(2026, 2, 9, 13, 15)
      vi.setSystemTime(date)
      expect(service.isInBriefingWindow(date)).toBe(true)
    })

    it('平日 10:00 はウィンドウ外', () => {
      const date = new Date(2026, 2, 9, 10, 0)
      vi.setSystemTime(date)
      expect(service.isInBriefingWindow(date)).toBe(false)
    })

    it('休日 9:45 はウィンドウ内（09:30〜10:00）', () => {
      const date = new Date(2026, 2, 8, 9, 45)  // 2026-03-08 (日)
      vi.setSystemTime(date)
      expect(service.isInBriefingWindow(date)).toBe(true)
    })

    it('休日 8:45 はウィンドウ外（休日パターンには 08:30〜09:00 がない）', () => {
      const date = new Date(2026, 2, 8, 8, 45)
      vi.setSystemTime(date)
      expect(service.isInBriefingWindow(date)).toBe(false)
    })

    it('パターンがない場合は false', () => {
      localStorage.clear()
      service = new ActivityPatternServiceImpl()
      const date = new Date(2026, 2, 9, 8, 45)
      expect(service.isInBriefingWindow(date)).toBe(false)
    })
  })

  describe('キャッシュ復元', () => {
    it('localStorage から有効なキャッシュを復元する', () => {
      setCachedPattern(createTestPattern())
      service = new ActivityPatternServiceImpl()
      expect(service.hasPattern()).toBe(true)
    })

    it('6時間以上経過したキャッシュは無効', () => {
      const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000 - 1
      setCachedPattern(createTestPattern(), sixHoursAgo)
      service = new ActivityPatternServiceImpl()
      expect(service.hasPattern()).toBe(false)
    })

    it('6時間以内のキャッシュは有効', () => {
      const fiveHoursAgo = Date.now() - 5 * 60 * 60 * 1000
      setCachedPattern(createTestPattern(), fiveHoursAgo)
      service = new ActivityPatternServiceImpl()
      expect(service.hasPattern()).toBe(true)
    })

    it('破損したキャッシュは無視する', () => {
      localStorage.setItem(PATTERN_CACHE_KEY, 'invalid json')
      service = new ActivityPatternServiceImpl()
      expect(service.hasPattern()).toBe(false)
    })
  })

  describe('ウィンドウなしのパターン', () => {
    it('weekday/weekend 共に空の場合は常に false', () => {
      setCachedPattern(createTestPattern({
        weekday: [],
        weekend: [],
        activeDays: 5,
      }))
      service = new ActivityPatternServiceImpl()

      const date = new Date(2026, 2, 9, 8, 45)
      expect(service.isInBriefingWindow(date)).toBe(false)
    })
  })
})
