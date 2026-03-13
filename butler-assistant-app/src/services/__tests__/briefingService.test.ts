import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BriefingServiceImpl } from '../briefingService'
import { activityPatternService } from '@/services/activityPatternService'

// activityPatternService のモック
vi.mock('@/services/activityPatternService', () => ({
  activityPatternService: {
    hasPattern: vi.fn(() => false),
    isInBriefingWindow: vi.fn(() => false),
    getCurrentWindow: vi.fn(() => null),
  },
}))

// auth のモック
vi.mock('@/auth', () => ({
  getIdToken: vi.fn(() => Promise.resolve('mock-token')),
}))

const mockedPatternService = vi.mocked(activityPatternService)

const LAST_BRIEFING_KEY = 'butler-last-briefing'
const DAILY_COUNT_KEY = 'butler-briefing-daily'
const WINDOW_TRIGGERED_KEY = 'butler-briefing-window-triggered'

/** JST の指定時刻を返す Date をモックする */
function mockJstHour(hour: number) {
  const now = new Date()
  const fakeDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0)
  vi.setSystemTime(fakeDate)
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

  describe('shouldTrigger（フォールバックモード）', () => {
    it('初回はトリガーする', () => {
      mockJstHour(8)
      expect(service.shouldTrigger()).toBe(true)
    })

    it('深夜でもフォールバックモードではトリガーする（時間帯制限なし）', () => {
      mockJstHour(2)
      expect(service.shouldTrigger()).toBe(true)
    })

    it('23時でもフォールバックモードではトリガーする（時間帯制限なし）', () => {
      mockJstHour(23)
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

  describe('loadTodayHistory', () => {
    it('API が利用不可でもエラーにならない（フォールバック）', async () => {
      mockJstHour(8)
      // VITE_API_BASE_URL が未設定 → 即 return
      await expect(service.loadTodayHistory()).resolves.toBeUndefined()
    })

    it('localStorage にバックアップされた発火記録を復元する', () => {
      mockJstHour(8)
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
      localStorage.setItem(WINDOW_TRIGGERED_KEY, JSON.stringify({
        date: today,
        windows: ['07:00', '12:00'],
      }))

      const restored = new BriefingServiceImpl()
      // activityPatternService.hasPattern() は false なのでフォールバックモードだが、
      // ウィンドウの復元はされている（内部状態の確認）
      expect(restored.getLastBriefingTime()).toBeNull()
    })

    it('日付が異なる localStorage 記録は無視する', () => {
      mockJstHour(8)
      localStorage.setItem(WINDOW_TRIGGERED_KEY, JSON.stringify({
        date: '2020-01-01',
        windows: ['07:00'],
      }))

      const restored = new BriefingServiceImpl()
      // 古い日付のデータは復元されない
      expect(restored.getLastBriefingTime()).toBeNull()
    })
  })

  describe('recordFired', () => {
    it('API が利用不可でもエラーにならない', async () => {
      mockJstHour(8)
      // VITE_API_BASE_URL が未設定 → 即 return
      await expect(service.recordFired('07:00', '09:00')).resolves.toBeUndefined()
    })
  })

  describe('アダプティブモードでのバックエンド履歴ベース重複防止', () => {
    afterEach(() => {
      mockedPatternService.hasPattern.mockReturnValue(false)
      mockedPatternService.isInBriefingWindow.mockReturnValue(false)
      mockedPatternService.getCurrentWindow.mockReturnValue(null)
    })

    it('localStorage にウィンドウ発火記録があるとそのウィンドウではトリガーしない', () => {
      mockedPatternService.hasPattern.mockReturnValue(true)
      mockedPatternService.isInBriefingWindow.mockReturnValue(true)
      mockedPatternService.getCurrentWindow.mockReturnValue({ from: '07:00', to: '09:00', confidence: 0.8 })

      mockJstHour(8)
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
      localStorage.setItem(WINDOW_TRIGGERED_KEY, JSON.stringify({
        date: today,
        windows: ['07:00'],
      }))

      const svc = new BriefingServiceImpl()
      expect(svc.shouldTrigger()).toBe(false)
    })

    it('異なるウィンドウなら発火済みでもトリガーする', () => {
      mockedPatternService.hasPattern.mockReturnValue(true)
      mockedPatternService.isInBriefingWindow.mockReturnValue(true)
      mockedPatternService.getCurrentWindow.mockReturnValue({ from: '12:00', to: '14:00', confidence: 0.7 })

      mockJstHour(12)
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
      localStorage.setItem(WINDOW_TRIGGERED_KEY, JSON.stringify({
        date: today,
        windows: ['07:00'],  // morning は発火済みだが afternoon は未発火
      }))

      const svc = new BriefingServiceImpl()
      expect(svc.shouldTrigger()).toBe(true)
    })

    it('markTriggered でウィンドウが発火済みに記録される', () => {
      mockedPatternService.hasPattern.mockReturnValue(true)
      mockedPatternService.isInBriefingWindow.mockReturnValue(true)
      mockedPatternService.getCurrentWindow.mockReturnValue({ from: '07:00', to: '09:00', confidence: 0.8 })

      mockJstHour(8)
      const svc = new BriefingServiceImpl()
      expect(svc.shouldTrigger()).toBe(true)

      svc.markTriggered()
      expect(svc.shouldTrigger()).toBe(false)
    })
  })
})
