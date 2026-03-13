/**
 * アクティビティパターンサービス
 *
 * バックエンドから取得したアクティビティパターン（曜日別セッション開始時刻のウィンドウ）を
 * ブリーフィング判定に提供する。
 */

import { getIdToken } from '@/auth'
import { APIError } from '@/types'

/**
 * ブリーフィングウィンドウ（バックエンドレスポンスと同一）
 */
export interface BriefingWindow {
  /** ウィンドウ開始 "HH:mm" */
  from: string
  /** ウィンドウ終了（セッション開始時刻） "HH:mm" */
  to: string
  /** 出現率 0〜1 */
  confidence: number
}

/**
 * アクティビティパターンレスポンス
 *
 * dayWindows: 曜日別ブリーフィングウィンドウ（キー: "0"=日〜"6"=土）
 */
export interface ActivityPattern {
  dayWindows: Record<string, BriefingWindow[]>
  analyzedDays: number
  activeDays: number
  updatedAt: string
}

/**
 * アクティビティパターンサービスインターフェース
 */
export interface ActivityPatternServiceInterface {
  /** パターンをバックエンドから取得してキャッシュ */
  loadPattern(): Promise<void>
  /** 現在時刻がブリーフィングウィンドウ内か判定 */
  isInBriefingWindow(now?: Date): boolean
  /** 現在時刻が属するウィンドウを返す（重複チェック用） */
  getCurrentWindow(now?: Date): BriefingWindow | null
  /** パターンデータが利用可能か */
  hasPattern(): boolean
}

/** パターンキャッシュの有効期間（ミリ秒）: 6時間 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

/** localStorage キー */
const PATTERN_CACHE_KEY = 'butler-activity-pattern'

interface CachedPattern {
  pattern: ActivityPattern
  cachedAt: number
}

/**
 * アクティビティパターンサービス実装
 */
class ActivityPatternServiceImpl implements ActivityPatternServiceInterface {
  private pattern: ActivityPattern | null = null

  constructor() {
    this._restoreFromCache()
  }

  /**
   * バックエンドからパターンを取得してキャッシュ
   */
  async loadPattern(): Promise<void> {
    // キャッシュが有効ならスキップ
    if (this.pattern && this._isCacheValid()) {
      return
    }

    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
    if (!apiBaseUrl) return

    try {
      const token = await getIdToken()
      if (!token) return

      const res = await fetch(`${apiBaseUrl}/users/activity`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })

      if (!res.ok) {
        if (res.status === 401) return
        throw new APIError(`API エラー (${res.status})`, res.status)
      }

      const data: ActivityPattern = await res.json()
      this.pattern = data
      this._saveToCache(data)
      const totalWindows = Object.values(data.dayWindows).reduce((sum, ws) => sum + ws.length, 0)
      console.log(`[ActivityPattern] パターン取得完了: ${totalWindows}件(${Object.keys(data.dayWindows).length}曜日), 活動日${data.activeDays}日`)
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        console.warn('[ActivityPattern] ネットワークエラー、キャッシュを継続利用')
        return
      }
      if (error instanceof APIError) {
        console.warn(`[ActivityPattern] APIエラー: ${error.message}`)
        return
      }
      console.warn('[ActivityPattern] パターン取得失敗:', error)
    }
  }

  /**
   * 現在時刻がブリーフィングウィンドウ内かを判定
   *
   * 現在の曜日に対応するウィンドウで判定する。
   * パターンデータがない場合は false を返す（フォールバックロジックを使うため）。
   */
  isInBriefingWindow(now?: Date): boolean {
    if (!this.pattern) return false

    const current = now ?? new Date()
    const dow = String(current.getDay())
    const windows = this.pattern.dayWindows[dow]
    if (!windows || windows.length === 0) return false

    const currentMinutes = current.getHours() * 60 + current.getMinutes()

    return windows.some((w) => {
      const fromMinutes = timeToMinutes(w.from)
      const toMinutes = timeToMinutes(w.to)
      if (fromMinutes <= toMinutes) {
        // 通常: 07:00〜09:00
        return currentMinutes >= fromMinutes && currentMinutes <= toMinutes
      }
      // 日跨ぎ: 21:00〜01:00 → 21:00〜24:00 or 00:00〜01:00
      return currentMinutes >= fromMinutes || currentMinutes <= toMinutes
    })
  }

  /**
   * 現在時刻が属するウィンドウを返す（重複チェック用）
   *
   * isInBriefingWindow と同じロジックだが、マッチしたウィンドウオブジェクトを返す。
   */
  getCurrentWindow(now?: Date): BriefingWindow | null {
    if (!this.pattern) return null

    const current = now ?? new Date()
    const dow = String(current.getDay())
    const windows = this.pattern.dayWindows[dow]
    if (!windows || windows.length === 0) return null

    const currentMinutes = current.getHours() * 60 + current.getMinutes()

    for (const w of windows) {
      const fromMinutes = timeToMinutes(w.from)
      const toMinutes = timeToMinutes(w.to)
      if (fromMinutes <= toMinutes) {
        if (currentMinutes >= fromMinutes && currentMinutes <= toMinutes) return w
      } else {
        if (currentMinutes >= fromMinutes || currentMinutes <= toMinutes) return w
      }
    }
    return null
  }

  /**
   * パターンデータが利用可能か（いずれかの曜日にウィンドウがあるか）
   */
  hasPattern(): boolean {
    if (!this.pattern || this.pattern.activeDays === 0) return false
    return Object.values(this.pattern.dayWindows).some((ws) => ws.length > 0)
  }

  /** localStorage からキャッシュを復元 */
  private _restoreFromCache(): void {
    try {
      const stored = localStorage.getItem(PATTERN_CACHE_KEY)
      if (!stored) return
      const cached: CachedPattern = JSON.parse(stored)
      if (this._isCacheValidAt(cached.cachedAt)) {
        this.pattern = cached.pattern
      }
    } catch {
      // キャッシュ破損時は無視
    }
  }

  /** localStorage にキャッシュを保存 */
  private _saveToCache(pattern: ActivityPattern): void {
    try {
      const cached: CachedPattern = { pattern, cachedAt: Date.now() }
      localStorage.setItem(PATTERN_CACHE_KEY, JSON.stringify(cached))
    } catch {
      // localStorage 容量超過時は無視
    }
  }

  /** 現在のキャッシュが有効期間内か */
  private _isCacheValid(): boolean {
    try {
      const stored = localStorage.getItem(PATTERN_CACHE_KEY)
      if (!stored) return false
      const cached: CachedPattern = JSON.parse(stored)
      return this._isCacheValidAt(cached.cachedAt)
    } catch {
      return false
    }
  }

  /** 指定時刻のキャッシュが有効期間内か */
  private _isCacheValidAt(cachedAt: number): boolean {
    return Date.now() - cachedAt < CACHE_TTL_MS
  }
}

/**
 * "HH:mm" → 0時からの分数
 */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/**
 * シングルトンインスタンス
 */
export const activityPatternService = new ActivityPatternServiceImpl()

/**
 * テスト用にクラスをエクスポート
 */
export { ActivityPatternServiceImpl }
