import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BriefingServiceImpl } from '../briefingService'

const LAST_BRIEFING_KEY = 'butler-last-briefing'
const DAILY_COUNT_KEY = 'butler-briefing-daily'

/** JST の指定時刻を返す Date をモックする */
function mockJstHour(hour: number) {
  const now = new Date()
  // toLocaleString で返る文字列を制御し、getHours() が hour を返すようにする
  const fakeDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0)
  vi.setSystemTime(fakeDate)
  // toLocaleString の timeZone 指定を無視してローカル時刻を返す（jsdom はシステム時刻 = JST として扱う）
}

describe('BriefingServiceImpl', () => {
  let service: BriefingServiceImpl

  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    service = new BriefingServiceImpl()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('shouldTrigger', () => {
    it('初回は許可時間帯内ならトリガーする', () => {
      mockJstHour(8)
      expect(service.shouldTrigger()).toBe(true)
    })

    it('深夜はトリガーしない', () => {
      mockJstHour(2)
      expect(service.shouldTrigger()).toBe(false)
    })

    it('23時以降はトリガーしない', () => {
      mockJstHour(23)
      expect(service.shouldTrigger()).toBe(false)
    })

    it('6時ちょうどはトリガーする', () => {
      mockJstHour(6)
      expect(service.shouldTrigger()).toBe(true)
    })

    it('markTriggered 後は3時間間隔チェックでブロックされる', () => {
      mockJstHour(8)
      service.markTriggered()
      expect(service.shouldTrigger()).toBe(false)
    })

    it('3時間経過後はトリガーする', () => {
      mockJstHour(8)
      service.markTriggered()

      // 3時間進める
      vi.advanceTimersByTime(3 * 60 * 60 * 1000)
      mockJstHour(11)
      expect(service.shouldTrigger()).toBe(true)
    })

    it('1日3回のブリーフィング上限でブロックされる', () => {
      mockJstHour(7)
      service.markTriggered()

      vi.advanceTimersByTime(3 * 60 * 60 * 1000)
      mockJstHour(10)
      service.markTriggered()

      vi.advanceTimersByTime(3 * 60 * 60 * 1000)
      mockJstHour(13)
      service.markTriggered()

      // 4回目: 3時間経過しても上限でブロック
      vi.advanceTimersByTime(3 * 60 * 60 * 1000)
      mockJstHour(16)
      expect(service.shouldTrigger()).toBe(false)
    })

    it('日付が変わるとカウントがリセットされる', () => {
      mockJstHour(7)
      service.markTriggered()
      service.markTriggered()
      service.markTriggered()

      // 翌日にする（dailyCount の日付が変わる）
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(8, 0, 0, 0)
      vi.setSystemTime(tomorrow)

      // 間隔は十分経過させる
      vi.advanceTimersByTime(3 * 60 * 60 * 1000)

      // 新しいインスタンスで localStorage から読み取り直す
      const freshService = new BriefingServiceImpl()
      expect(freshService.shouldTrigger()).toBe(true)
    })
  })

  describe('markTriggered', () => {
    it('メモリキャッシュと localStorage の両方を更新する', () => {
      mockJstHour(8)
      const before = Date.now()
      service.markTriggered()

      expect(service.getLastBriefingTime()).toBeGreaterThanOrEqual(before)
      expect(localStorage.getItem(LAST_BRIEFING_KEY)).not.toBeNull()
    })

    it('dailyCount を localStorage に記録する', () => {
      mockJstHour(8)
      service.markTriggered()

      const stored = localStorage.getItem(DAILY_COUNT_KEY)
      expect(stored).not.toBeNull()
      const data = JSON.parse(stored!)
      expect(data.count).toBe(1)
    })
  })

  describe('getLastBriefingTime', () => {
    it('未実行時は null を返す', () => {
      expect(service.getLastBriefingTime()).toBeNull()
    })

    it('markTriggered 後は記録した時刻を返す', () => {
      mockJstHour(10)
      service.markTriggered()
      expect(service.getLastBriefingTime()).toBe(Date.now())
    })
  })

  describe('メモリキャッシュによるレース条件防止', () => {
    it('markTriggered 直後の shouldTrigger は即座に false を返す', () => {
      mockJstHour(8)
      expect(service.shouldTrigger()).toBe(true)

      service.markTriggered()

      // localStorage の読み取りなしにメモリキャッシュで即座にブロック
      expect(service.shouldTrigger()).toBe(false)
    })

    it('連続で shouldTrigger を呼んでも markTriggered 前は true を返す', () => {
      mockJstHour(8)
      // markTriggered を呼ばない限り、何度 shouldTrigger を呼んでも true
      expect(service.shouldTrigger()).toBe(true)
      expect(service.shouldTrigger()).toBe(true)
    })
  })

  describe('localStorage からの復元', () => {
    it('コンストラクタで localStorage のデータを復元する', () => {
      const now = Date.now()
      localStorage.setItem(LAST_BRIEFING_KEY, String(now))

      const restored = new BriefingServiceImpl()
      expect(restored.getLastBriefingTime()).toBe(now)
    })

    it('localStorage に不正な値がある場合は null として扱う', () => {
      localStorage.setItem(LAST_BRIEFING_KEY, 'invalid')

      const restored = new BriefingServiceImpl()
      expect(restored.getLastBriefingTime()).toBeNull()
    })
  })
})
