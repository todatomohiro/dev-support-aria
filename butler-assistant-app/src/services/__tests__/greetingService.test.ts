import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GreetingServiceImpl } from '../greetingService'
import type { TimeOfDay, AbsencePeriod } from '../greetingService'

describe('GreetingService', () => {
  let service: GreetingServiceImpl

  beforeEach(() => {
    service = new GreetingServiceImpl()
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('getTimeOfDay', () => {
    const testCases: Array<{ hour: number; expected: TimeOfDay; label: string }> = [
      { hour: 5, expected: 'morning', label: '5時は morning' },
      { hour: 8, expected: 'morning', label: '8時は morning' },
      { hour: 10, expected: 'morning', label: '10時は morning' },
      { hour: 11, expected: 'daytime', label: '11時は daytime' },
      { hour: 14, expected: 'daytime', label: '14時は daytime' },
      { hour: 16, expected: 'daytime', label: '16時は daytime' },
      { hour: 17, expected: 'evening', label: '17時は evening' },
      { hour: 19, expected: 'evening', label: '19時は evening' },
      { hour: 20, expected: 'evening', label: '20時は evening' },
      { hour: 21, expected: 'night', label: '21時は night' },
      { hour: 23, expected: 'night', label: '23時は night' },
      { hour: 0, expected: 'night', label: '0時は night' },
      { hour: 1, expected: 'night', label: '1時は night' },
      { hour: 2, expected: 'lateNight', label: '2時は lateNight' },
      { hour: 3, expected: 'lateNight', label: '3時は lateNight' },
      { hour: 4, expected: 'lateNight', label: '4時は lateNight' },
    ]

    testCases.forEach(({ hour, expected, label }) => {
      it(label, () => {
        // JST の指定時刻を作成（UTC で渡す）
        const date = new Date(`2026-03-04T${String(hour).padStart(2, '0')}:00:00+09:00`)
        expect(service.getTimeOfDay(date)).toBe(expected)
      })
    })
  })

  describe('getAbsencePeriod', () => {
    const NOW = Date.now()

    it('lastActiveTimestamp が null なら firstTime', () => {
      expect(service.getAbsencePeriod(null, NOW)).toBe('firstTime')
    })

    it('12時間前なら none', () => {
      const twelveHoursAgo = NOW - 12 * 60 * 60 * 1000
      expect(service.getAbsencePeriod(twelveHoursAgo, NOW)).toBe('none')
    })

    it('36時間前なら day', () => {
      const thirtyySixHoursAgo = NOW - 36 * 60 * 60 * 1000
      expect(service.getAbsencePeriod(thirtyySixHoursAgo, NOW)).toBe('day')
    })

    it('96時間前（4日）なら fewDays', () => {
      const ninetySixHoursAgo = NOW - 96 * 60 * 60 * 1000
      expect(service.getAbsencePeriod(ninetySixHoursAgo, NOW)).toBe('fewDays')
    })

    it('8日前なら week', () => {
      const eightDaysAgo = NOW - 8 * 24 * 60 * 60 * 1000
      expect(service.getAbsencePeriod(eightDaysAgo, NOW)).toBe('week')
    })

    it('23時間59分前はまだ none', () => {
      const justUnder24h = NOW - (24 * 60 * 60 * 1000 - 60000)
      expect(service.getAbsencePeriod(justUnder24h, NOW)).toBe('none')
    })

    it('ちょうど24時間前は day', () => {
      const exactly24h = NOW - 24 * 60 * 60 * 1000
      expect(service.getAbsencePeriod(exactly24h, NOW)).toBe('day')
    })
  })

  describe('getGreeting', () => {
    it('firstTime の場合、bow モーション + happy 感情', () => {
      const greeting = service.getGreeting(null)
      expect(greeting.motion).toBe('bow')
      expect(greeting.emotion).toBe('happy')
      expect(greeting.message).toBeTruthy()
    })

    it('none + morning の場合、happy 感情', () => {
      const now = Date.now()
      const recentTimestamp = now - 1 * 60 * 60 * 1000 // 1時間前
      const morningDate = new Date('2026-03-04T08:00:00+09:00')

      // getAbsencePeriod に now を渡せないので、recentTimestamp を使用
      const greeting = service.getGreeting(recentTimestamp, morningDate)
      expect(greeting.emotion).toBe('happy')
      expect(greeting.message).toBeTruthy()
    })

    it('none + lateNight の場合、surprised または troubled 感情', () => {
      const recentTimestamp = Date.now() - 1 * 60 * 60 * 1000
      const lateNightDate = new Date('2026-03-04T03:00:00+09:00')

      const greeting = service.getGreeting(recentTimestamp, lateNightDate)
      expect(['surprised', 'troubled']).toContain(greeting.emotion)
    })

    it('day の場合、smile モーション + happy 感情', () => {
      const dayAgo = Date.now() - 36 * 60 * 60 * 1000
      const greeting = service.getGreeting(dayAgo)
      expect(greeting.motion).toBe('smile')
      expect(greeting.emotion).toBe('happy')
    })

    it('fewDays の場合、bow モーション + happy 感情', () => {
      const fewDaysAgo = Date.now() - 96 * 60 * 60 * 1000
      const greeting = service.getGreeting(fewDaysAgo)
      expect(greeting.motion).toBe('bow')
      expect(greeting.emotion).toBe('happy')
    })

    it('week の場合、bow モーション', () => {
      const weekAgo = Date.now() - 8 * 24 * 60 * 60 * 1000
      const greeting = service.getGreeting(weekAgo)
      expect(greeting.motion).toBe('bow')
      expect(['happy', 'surprised']).toContain(greeting.emotion)
    })

    it('メッセージは空文字でない', () => {
      const greeting = service.getGreeting(null)
      expect(greeting.message.length).toBeGreaterThan(0)
    })
  })

  describe('hasGreetedToday / markGreeted', () => {
    it('初期状態では挨拶未済み', () => {
      expect(service.hasGreetedToday()).toBe(false)
    })

    it('markGreeted 後は挨拶済み', () => {
      const date = new Date('2026-03-04T12:00:00+09:00')
      service.markGreeted(date)
      expect(service.hasGreetedToday(date)).toBe(true)
    })

    it('異なる日付では挨拶未済み', () => {
      const today = new Date('2026-03-04T12:00:00+09:00')
      const tomorrow = new Date('2026-03-05T12:00:00+09:00')
      service.markGreeted(today)
      expect(service.hasGreetedToday(tomorrow)).toBe(false)
    })

    it('同じ日付なら時刻が異なっても挨拶済み', () => {
      const morning = new Date('2026-03-04T08:00:00+09:00')
      const evening = new Date('2026-03-04T20:00:00+09:00')
      service.markGreeted(morning)
      expect(service.hasGreetedToday(evening)).toBe(true)
    })

    it('localStorage に日付文字列が保存される', () => {
      const date = new Date('2026-03-04T12:00:00+09:00')
      service.markGreeted(date)
      expect(localStorage.getItem('butler-greeting-date')).toBe('2026-03-04')
    })
  })
})
