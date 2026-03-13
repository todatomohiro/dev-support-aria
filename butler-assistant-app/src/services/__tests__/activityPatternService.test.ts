import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ActivityPatternServiceImpl } from '../activityPatternService'
import type { ActivityPattern } from '../activityPatternService'

const PATTERN_CACHE_KEY = 'butler-activity-pattern'

/** テスト用のアクティビティパターン（曜日別） */
function createTestPattern(overrides?: Partial<ActivityPattern>): ActivityPattern {
  return {
    dayWindows: {
      // 月曜 (1)
      '1': [
        { from: '07:00', to: '09:00', confidence: 0.85 },
        { from: '11:00', to: '14:00', confidence: 0.7 },
        { from: '19:00', to: '21:00', confidence: 0.4 },
      ],
      // 火曜 (2)
      '2': [
        { from: '08:00', to: '10:00', confidence: 0.75 },
        { from: '12:00', to: '15:00', confidence: 0.6 },
      ],
      // 日曜 (0) — ウィンドウなし（データ不足）
    },
    analyzedDays: 28,
    activeDays: 20,
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

    it('dayWindows が空の場合は false', () => {
      setCachedPattern(createTestPattern({ dayWindows: {} }))
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

    it('月曜 8:30 はウィンドウ内（07:00〜09:00）', () => {
      const date = new Date(2026, 2, 9, 8, 30)  // 2026-03-09 (月)
      vi.setSystemTime(date)
      expect(service.isInBriefingWindow(date)).toBe(true)
    })

    it('月曜 6:59 はウィンドウ外', () => {
      const date = new Date(2026, 2, 9, 6, 59)
      vi.setSystemTime(date)
      expect(service.isInBriefingWindow(date)).toBe(false)
    })

    it('月曜 12:00 はウィンドウ内（11:00〜14:00）', () => {
      const date = new Date(2026, 2, 9, 12, 0)
      vi.setSystemTime(date)
      expect(service.isInBriefingWindow(date)).toBe(true)
    })

    it('火曜 9:00 はウィンドウ内（08:00〜10:00）', () => {
      const date = new Date(2026, 2, 10, 9, 0)  // 2026-03-10 (火)
      vi.setSystemTime(date)
      expect(service.isInBriefingWindow(date)).toBe(true)
    })

    it('火曜 7:30 はウィンドウ外（火曜は 08:00〜10:00 が最初）', () => {
      const date = new Date(2026, 2, 10, 7, 30)
      vi.setSystemTime(date)
      expect(service.isInBriefingWindow(date)).toBe(false)
    })

    it('日曜はウィンドウなし → 常に false', () => {
      const date = new Date(2026, 2, 8, 8, 30)  // 2026-03-08 (日)
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

  describe('getCurrentWindow', () => {
    beforeEach(() => {
      setCachedPattern(createTestPattern())
      service = new ActivityPatternServiceImpl()
    })

    it('月曜 8:30 はウィンドウ 07:00〜09:00 を返す', () => {
      const date = new Date(2026, 2, 9, 8, 30)  // 2026-03-09 (月)
      vi.setSystemTime(date)
      const w = service.getCurrentWindow(date)
      expect(w).not.toBeNull()
      expect(w!.from).toBe('07:00')
      expect(w!.to).toBe('09:00')
    })

    it('月曜 6:59 はウィンドウ外なので null', () => {
      const date = new Date(2026, 2, 9, 6, 59)
      vi.setSystemTime(date)
      expect(service.getCurrentWindow(date)).toBeNull()
    })

    it('月曜 12:00 はウィンドウ 11:00〜14:00 を返す', () => {
      const date = new Date(2026, 2, 9, 12, 0)
      vi.setSystemTime(date)
      const w = service.getCurrentWindow(date)
      expect(w).not.toBeNull()
      expect(w!.from).toBe('11:00')
      expect(w!.to).toBe('14:00')
    })

    it('日曜はウィンドウなし → null', () => {
      const date = new Date(2026, 2, 8, 8, 30)  // 2026-03-08 (日)
      vi.setSystemTime(date)
      expect(service.getCurrentWindow(date)).toBeNull()
    })

    it('パターンがない場合は null', () => {
      localStorage.clear()
      service = new ActivityPatternServiceImpl()
      const date = new Date(2026, 2, 9, 8, 45)
      expect(service.getCurrentWindow(date)).toBeNull()
    })
  })

  describe('ウィンドウなしのパターン', () => {
    it('全曜日ウィンドウ空の場合は hasPattern=false', () => {
      setCachedPattern(createTestPattern({
        dayWindows: {},
        activeDays: 5,
      }))
      service = new ActivityPatternServiceImpl()
      expect(service.hasPattern()).toBe(false)
    })

    it('全曜日ウィンドウ空の場合は isInBriefingWindow=false', () => {
      setCachedPattern(createTestPattern({
        dayWindows: {},
        activeDays: 5,
      }))
      service = new ActivityPatternServiceImpl()
      const date = new Date(2026, 2, 9, 8, 45)
      expect(service.isInBriefingWindow(date)).toBe(false)
    })
  })
})
