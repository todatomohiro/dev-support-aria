/**
 * ブリーフィングサービス
 * アプリ起動時・復帰時にAIから自発的に話しかけるトリガーを管理
 */

/** localStorage キー */
const LAST_BRIEFING_KEY = 'butler-last-briefing'

/** ブリーフィング最小間隔（ミリ秒）: 3時間 */
const BRIEFING_INTERVAL_MS = 3 * 60 * 60 * 1000

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
 * ブリーフィングサービス実装
 */
class BriefingServiceImpl implements BriefingServiceInterface {
  /**
   * ブリーフィングを発火すべきか判定
   *
   * 条件:
   * 1. 前回ブリーフィングから BRIEFING_INTERVAL_MS 以上経過
   * 2. 現在時刻が許可時間帯内（JST 6:00〜23:00）
   */
  shouldTrigger(): boolean {
    // 時間帯チェック（JST）
    const now = new Date()
    const jstHour = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })).getHours()
    if (jstHour < BRIEFING_HOUR_START || jstHour >= BRIEFING_HOUR_END) {
      return false
    }

    // 間隔チェック
    const last = this.getLastBriefingTime()
    if (last === null) {
      // 初回は常にトリガー
      return true
    }

    return Date.now() - last >= BRIEFING_INTERVAL_MS
  }

  /**
   * ブリーフィング実行済みを記録
   */
  markTriggered(): void {
    localStorage.setItem(LAST_BRIEFING_KEY, String(Date.now()))
  }

  /**
   * 最終ブリーフィング時刻を取得
   */
  getLastBriefingTime(): number | null {
    const stored = localStorage.getItem(LAST_BRIEFING_KEY)
    if (!stored) return null
    const ts = parseInt(stored, 10)
    return isNaN(ts) ? null : ts
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
