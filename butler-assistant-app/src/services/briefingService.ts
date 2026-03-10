/**
 * ブリーフィングサービス
 *
 * アプリ起動時・復帰時にAIから自発的に話しかけるトリガーを管理する。
 *
 * アダプティブモード（アクティビティパターンあり）:
 *   ユーザーの過去の利用パターンから算出された「ブリーフィングウィンドウ」内で発火。
 *   セッション開始30分前〜開始時刻がウィンドウ。各ウィンドウにつき1回のみ。
 *
 * フォールバックモード（パターンなし）:
 *   従来通り、前回から3時間以上経過していれば発火。
 */

import { activityPatternService } from '@/services/activityPatternService'

/** localStorage キー */
const LAST_BRIEFING_KEY = 'butler-last-briefing'
const DAILY_COUNT_KEY = 'butler-briefing-daily'
const WINDOW_TRIGGERED_KEY = 'butler-briefing-window-triggered'

/** フォールバック: ブリーフィング最小間隔（ミリ秒）: 3時間 */
const FALLBACK_INTERVAL_MS = 3 * 60 * 60 * 1000

/** フォールバック: 1日あたりのブリーフィング上限 */
const FALLBACK_MAX_DAILY = 3

/** アダプティブ: 1日あたりの絶対上限（安全弁） */
const ADAPTIVE_MAX_DAILY = 8

/** ブリーフィング許可時間帯（JST） */
const BRIEFING_HOUR_START = 6
const BRIEFING_HOUR_END = 23

/**
 * ブリーフィングサービスインターフェース
 */
export interface BriefingServiceInterface {
  /** ブリーフィングを発火すべきか判定 */
  shouldTrigger(): boolean
  /** ブリーフィング実行済みを記録 */
  markTriggered(): void
  /** 最終ブリーフィング時刻を取得 */
  getLastBriefingTime(): number | null
}

/**
 * 1日のブリーフィング回数管理
 */
interface DailyCount {
  date: string
  count: number
}

/**
 * ウィンドウ別の発火済み記録（同じウィンドウで2回発火しないため）
 */
interface WindowTriggered {
  date: string
  /** 発火済みウィンドウの "from" 時刻リスト */
  windows: string[]
}

/**
 * ブリーフィングサービス実装
 */
class BriefingServiceImpl implements BriefingServiceInterface {
  /** メモリキャッシュ: localStorage 読み取りを減らし、レース条件を防ぐ */
  private lastTriggeredAt: number | null = null

  constructor() {
    this.lastTriggeredAt = this._readLastBriefingTime()
  }

  /**
   * ブリーフィングを発火すべきか判定
   *
   * アダプティブモード（パターンあり）:
   *   1. 時間帯チェック（JST 6:00〜23:00）
   *   2. 1日の絶対上限チェック
   *   3. 現在時刻がブリーフィングウィンドウ内か
   *   4. そのウィンドウで未発火か
   *
   * フォールバックモード（パターンなし）:
   *   1. 時間帯チェック（JST 6:00〜23:00）
   *   2. 前回から3時間以上経過
   *   3. 1日の上限（3回）チェック
   */
  shouldTrigger(): boolean {
    // 共通: 時間帯チェック（JST）
    const now = new Date()
    const jstHour = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })).getHours()
    if (jstHour < BRIEFING_HOUR_START || jstHour >= BRIEFING_HOUR_END) {
      return false
    }

    // アダプティブモード
    if (activityPatternService.hasPattern()) {
      return this._shouldTriggerAdaptive(now)
    }

    // フォールバックモード
    return this._shouldTriggerFallback()
  }

  /**
   * ブリーフィング実行済みを記録
   */
  markTriggered(): void {
    const now = Date.now()
    this.lastTriggeredAt = now
    localStorage.setItem(LAST_BRIEFING_KEY, String(now))
    this._incrementDailyCount()

    // アダプティブモード: 現在のウィンドウを発火済みに記録
    if (activityPatternService.hasPattern()) {
      this._markWindowTriggered(new Date(now))
    }
  }

  /**
   * 最終ブリーフィング時刻を取得
   */
  getLastBriefingTime(): number | null {
    return this.lastTriggeredAt
  }

  /**
   * アダプティブモードの判定
   */
  private _shouldTriggerAdaptive(now: Date): boolean {
    // 1日の絶対上限
    if (this._getDailyCount() >= ADAPTIVE_MAX_DAILY) {
      return false
    }

    // ウィンドウ内かチェック
    if (!activityPatternService.isInBriefingWindow(now)) {
      return false
    }

    // このウィンドウで既に発火済みかチェック
    if (this._isWindowAlreadyTriggered(now)) {
      return false
    }

    return true
  }

  /**
   * フォールバックモードの判定（従来ロジック）
   */
  private _shouldTriggerFallback(): boolean {
    // 間隔チェック
    const last = this.lastTriggeredAt
    if (last !== null && Date.now() - last < FALLBACK_INTERVAL_MS) {
      return false
    }

    // 1日の上限チェック
    if (this._getDailyCount() >= FALLBACK_MAX_DAILY) {
      return false
    }

    return true
  }

  /**
   * 現在時刻が属するウィンドウが既に発火済みかチェック
   */
  private _isWindowAlreadyTriggered(now: Date): boolean {
    const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
    try {
      const stored = localStorage.getItem(WINDOW_TRIGGERED_KEY)
      if (!stored) return false
      const data: WindowTriggered = JSON.parse(stored)
      if (data.date !== today) return false

      // 現在のウィンドウの "from" を特定
      const currentWindow = this._getCurrentWindowKey(now)
      if (!currentWindow) return false

      return data.windows.includes(currentWindow)
    } catch {
      return false
    }
  }

  /**
   * 現在時刻が属するウィンドウの "from" 時刻を返す
   */
  private _getCurrentWindowKey(now: Date): string | null {
    const dayOfWeek = now.getDay()
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

    // activityPatternService のパターンを直接参照はできないので、
    // isInBriefingWindow が true の時点で呼ばれる前提。
    // 現在時刻を15分単位に丸めてキーにする。
    const minutes = now.getHours() * 60 + now.getMinutes()
    const binned = Math.floor(minutes / 15) * 15
    const h = Math.floor(binned / 60)
    const m = binned % 60
    return `${isWeekend ? 'we' : 'wd'}:${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  /**
   * 現在のウィンドウを発火済みとして記録
   */
  private _markWindowTriggered(now: Date): void {
    const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
    const windowKey = this._getCurrentWindowKey(now)
    if (!windowKey) return

    try {
      const stored = localStorage.getItem(WINDOW_TRIGGERED_KEY)
      let data: WindowTriggered = { date: today, windows: [] }
      if (stored) {
        const parsed: WindowTriggered = JSON.parse(stored)
        if (parsed.date === today) {
          data = parsed
        }
      }
      if (!data.windows.includes(windowKey)) {
        data.windows.push(windowKey)
      }
      localStorage.setItem(WINDOW_TRIGGERED_KEY, JSON.stringify(data))
    } catch {
      // localStorage エラーは無視
    }
  }

  /** localStorage から最終ブリーフィング時刻を読み取る */
  private _readLastBriefingTime(): number | null {
    const stored = localStorage.getItem(LAST_BRIEFING_KEY)
    if (!stored) return null
    const ts = parseInt(stored, 10)
    return isNaN(ts) ? null : ts
  }

  /** 当日のブリーフィング回数を取得 */
  private _getDailyCount(): number {
    const stored = localStorage.getItem(DAILY_COUNT_KEY)
    if (!stored) return 0
    try {
      const data: DailyCount = JSON.parse(stored)
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
      if (data.date === today) return data.count
      return 0
    } catch {
      return 0
    }
  }

  /** 当日のブリーフィング回数をインクリメント */
  private _incrementDailyCount(): void {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
    const current = this._getDailyCount()
    const data: DailyCount = { date: today, count: current + 1 }
    localStorage.setItem(DAILY_COUNT_KEY, JSON.stringify(data))
  }
}

/**
 * ブリーフィングサービスのシングルトンインスタンス
 */
export const briefingService = new BriefingServiceImpl()

/**
 * テスト用にクラスをエクスポート
 */
export { BriefingServiceImpl }
