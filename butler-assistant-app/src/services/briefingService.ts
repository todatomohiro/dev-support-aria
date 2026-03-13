/**
 * ブリーフィングサービス
 *
 * アプリ起動時・復帰時にAIから自発的に話しかけるトリガーを管理する。
 *
 * アダプティブモード（アクティビティパターンあり）:
 *   ユーザーの過去の利用パターンから算出された「ブリーフィングウィンドウ」内で発火。
 *   各ウィンドウにつき1回のみ。重複チェックはバックエンド履歴 + メモリキャッシュ。
 *
 * フォールバックモード（パターンなし）:
 *   従来通り、前回から3時間以上経過していれば発火。
 */

import { getIdToken } from '@/auth'
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
  /** バックエンドから今日の発火履歴をロード */
  loadTodayHistory(): Promise<void>
  /** バックエンドに発火を記録（fire-and-forget） */
  recordFired(windowFrom: string, windowTo: string): Promise<void>
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
 * バックエンドの発火履歴レスポンス
 */
interface BriefingHistoryResponse {
  date: string
  triggeredWindows: { windowFrom: string; windowTo: string; firedAt: string }[]
}

/**
 * ブリーフィングサービス実装
 */
class BriefingServiceImpl implements BriefingServiceInterface {
  /** メモリキャッシュ: localStorage 読み取りを減らし、レース条件を防ぐ */
  private lastTriggeredAt: number | null = null
  /** メモリキャッシュ: 今日の発火済みウィンドウ（"from" 時刻のSet） */
  private todayTriggeredWindows: Set<string> = new Set()
  /** 今日の日付（リセット判定用） */
  private todayDate: string = ''

  constructor() {
    this.lastTriggeredAt = this._readLastBriefingTime()
    this._restoreWindowTriggered()
  }

  /**
   * バックエンドから今日の発火履歴をロード
   *
   * アプリ起動時・visibilitychange 時に呼ばれる。
   * バックエンドの履歴でメモリキャッシュと localStorage を同期する。
   */
  async loadTodayHistory(): Promise<void> {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
    if (!apiBaseUrl) return

    try {
      const token = await getIdToken()
      if (!token) return

      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
      const res = await fetch(`${apiBaseUrl}/users/activity?action=briefing&date=${today}`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })

      if (!res.ok) return

      const data: BriefingHistoryResponse = await res.json()

      // メモリキャッシュを更新
      this.todayDate = today
      this.todayTriggeredWindows = new Set(data.triggeredWindows.map((w) => w.windowFrom))

      // localStorage も同期（オフラインフォールバック用）
      const windowData: WindowTriggered = {
        date: today,
        windows: [...this.todayTriggeredWindows],
      }
      localStorage.setItem(WINDOW_TRIGGERED_KEY, JSON.stringify(windowData))

      console.log(`[Briefing] 発火履歴ロード: ${data.triggeredWindows.length}件 (${today})`)
    } catch (error) {
      console.warn('[Briefing] 発火履歴の取得に失敗、ローカルキャッシュを継続利用:', error)
    }
  }

  /**
   * バックエンドに発火を記録（fire-and-forget）
   */
  async recordFired(windowFrom: string, windowTo: string): Promise<void> {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
    if (!apiBaseUrl) return

    try {
      const token = await getIdToken()
      if (!token) return

      await fetch(`${apiBaseUrl}/users/activity?action=briefing`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ windowFrom, windowTo }),
      })
    } catch {
      // fire-and-forget: エラーは無視
    }
  }

  /**
   * ブリーフィングを発火すべきか判定
   *
   * アダプティブモード（パターンあり）:
   *   1. 1日の絶対上限チェック
   *   2. 現在時刻がブリーフィングウィンドウ内か
   *   3. そのウィンドウで未発火か（メモリキャッシュ）
   *
   * フォールバックモード（パターンなし）:
   *   1. 前回から3時間以上経過
   *   2. 1日の上限（3回）チェック
   */
  shouldTrigger(): boolean {
    // アダプティブモード
    if (activityPatternService.hasPattern()) {
      return this._shouldTriggerAdaptive(new Date())
    }

    // フォールバックモード
    return this._shouldTriggerFallback()
  }

  /**
   * ブリーフィング実行済みを記録（メモリキャッシュ即座更新）
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

    // このウィンドウで既に発火済みかチェック（メモリキャッシュ）
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
   * 現在時刻が属するウィンドウが既に発火済みかチェック（メモリキャッシュ優先）
   */
  private _isWindowAlreadyTriggered(now: Date): boolean {
    const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })

    // 日付が変わったらリセット
    if (this.todayDate !== today) {
      this.todayTriggeredWindows.clear()
      this.todayDate = today
    }

    // 現在のウィンドウの "from" を特定
    const currentWindow = activityPatternService.getCurrentWindow(now)
    if (!currentWindow) return false

    return this.todayTriggeredWindows.has(currentWindow.from)
  }

  /**
   * 現在のウィンドウを発火済みとして記録（メモリキャッシュ + localStorage）
   */
  private _markWindowTriggered(now: Date): void {
    const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })

    // 日付が変わったらリセット
    if (this.todayDate !== today) {
      this.todayTriggeredWindows.clear()
      this.todayDate = today
    }

    const currentWindow = activityPatternService.getCurrentWindow(now)
    if (!currentWindow) return

    this.todayTriggeredWindows.add(currentWindow.from)

    // localStorage にもバックアップ
    try {
      const windowData: WindowTriggered = {
        date: today,
        windows: [...this.todayTriggeredWindows],
      }
      localStorage.setItem(WINDOW_TRIGGERED_KEY, JSON.stringify(windowData))
    } catch {
      // localStorage エラーは無視
    }
  }

  /** localStorage からウィンドウ発火記録を復元 */
  private _restoreWindowTriggered(): void {
    try {
      const stored = localStorage.getItem(WINDOW_TRIGGERED_KEY)
      if (!stored) return
      const data: WindowTriggered = JSON.parse(stored)
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
      if (data.date === today) {
        this.todayDate = today
        this.todayTriggeredWindows = new Set(data.windows)
      }
    } catch {
      // 復元失敗時は無視
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
