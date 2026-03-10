/**
 * ブリーフィングサービス
 * アプリ起動時・復帰時にAIから自発的に話しかけるトリガーを管理
 */

/** localStorage キー */
const LAST_BRIEFING_KEY = 'butler-last-briefing'
const DAILY_COUNT_KEY = 'butler-briefing-daily'

/** ブリーフィング最小間隔（ミリ秒）: 3時間 */
const BRIEFING_INTERVAL_MS = 3 * 60 * 60 * 1000

/** 1日あたりのブリーフィング上限 */
const MAX_DAILY_BRIEFINGS = 3

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
 * ブリーフィングサービス実装
 */
class BriefingServiceImpl implements BriefingServiceInterface {
  /** メモリキャッシュ: localStorage 読み取りを減らし、レース条件を防ぐ */
  private lastTriggeredAt: number | null = null

  constructor() {
    // 起動時に localStorage からキャッシュを復元
    this.lastTriggeredAt = this._readLastBriefingTime()
  }

  /**
   * ブリーフィングを発火すべきか判定
   *
   * 条件:
   * 1. 前回ブリーフィングから BRIEFING_INTERVAL_MS 以上経過
   * 2. 現在時刻が許可時間帯内（JST 6:00〜23:00）
   * 3. 当日のブリーフィング回数が上限未満
   */
  shouldTrigger(): boolean {
    // 時間帯チェック（JST）
    const now = new Date()
    const jstHour = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })).getHours()
    if (jstHour < BRIEFING_HOUR_START || jstHour >= BRIEFING_HOUR_END) {
      return false
    }

    // 間隔チェック（メモリキャッシュ優先）
    const last = this.lastTriggeredAt
    if (last !== null && Date.now() - last < BRIEFING_INTERVAL_MS) {
      return false
    }

    // 1日の上限チェック
    if (this._getDailyCount() >= MAX_DAILY_BRIEFINGS) {
      return false
    }

    return true
  }

  /**
   * ブリーフィング実行済みを記録
   * メモリキャッシュと localStorage の両方を更新
   */
  markTriggered(): void {
    const now = Date.now()
    this.lastTriggeredAt = now
    localStorage.setItem(LAST_BRIEFING_KEY, String(now))
    this._incrementDailyCount()
  }

  /**
   * 最終ブリーフィング時刻を取得
   */
  getLastBriefingTime(): number | null {
    return this.lastTriggeredAt
  }

  /**
   * localStorage から最終ブリーフィング時刻を読み取る
   */
  private _readLastBriefingTime(): number | null {
    const stored = localStorage.getItem(LAST_BRIEFING_KEY)
    if (!stored) return null
    const ts = parseInt(stored, 10)
    return isNaN(ts) ? null : ts
  }

  /**
   * 当日のブリーフィング回数を取得
   */
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

  /**
   * 当日のブリーフィング回数をインクリメント
   */
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
