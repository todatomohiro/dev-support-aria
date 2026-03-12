/**
 * 使用量管理サービス
 *
 * レートリミット情報の取得・ローカルチェックを行う。
 */
import type { UsageInfo, UserPlan, ModelKey } from '@/types'
import { getIdToken } from '@/auth'

/** 使用量サービスインターフェース */
export interface UsageServiceInterface {
  /** サーバーから使用量情報を取得 */
  fetchUsage(): Promise<UsageInfo | null>
  /** ローカルの使用量情報でメッセージ送信可否をチェック */
  canSendMessage(usageInfo: UsageInfo | null, modelKey: ModelKey): { allowed: boolean; reason?: string }
  /** プランを変更（開発用セルフサービス） */
  updatePlan(plan: UserPlan): Promise<boolean>
}

class UsageServiceImpl implements UsageServiceInterface {
  /** サーバーから使用量情報を取得 */
  async fetchUsage(): Promise<UsageInfo | null> {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
    if (!apiBaseUrl) return null

    try {
      const token = await getIdToken()
      if (!token) return null

      const res = await fetch(`${apiBaseUrl}/usage`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!res.ok) {
        console.warn('[UsageService] 使用量取得失敗:', res.status)
        return null
      }

      return await res.json() as UsageInfo
    } catch (error) {
      console.warn('[UsageService] 使用量取得エラー:', error)
      return null
    }
  }

  /** ローカルの使用量情報でメッセージ送信可否をチェック */
  canSendMessage(usageInfo: UsageInfo | null, modelKey: ModelKey): { allowed: boolean; reason?: string } {
    // 使用量情報がない場合は許可（サーバー側でチェックする）
    if (!usageInfo) return { allowed: true }

    // モデル制限
    if (!usageInfo.allowedModels.includes(modelKey)) {
      return { allowed: false, reason: 'Premium モードは有料プランで利用できます' }
    }

    // 日次制限（limit < 0 は無制限）
    if (usageInfo.daily.limit > 0 && usageInfo.daily.remaining <= 0) {
      return { allowed: false, reason: '今日のお話回数の上限に達しました' }
    }

    // 月次制限（limit < 0 は無制限）
    if (usageInfo.monthly.limit > 0 && usageInfo.monthly.remaining <= 0) {
      return { allowed: false, reason: '今月のお話回数の上限に達しました' }
    }

    // Premium モード月次制限
    const isPremiumModel = modelKey === 'sonnet' || modelKey === 'opus'
    if (isPremiumModel && usageInfo.premiumMonthly.limit > 0 && usageInfo.premiumMonthly.remaining <= 0) {
      return { allowed: false, reason: '今月の Premium モードの利用回数の上限に達しました。Normal モードをご利用ください。' }
    }

    return { allowed: true }
  }

  /** プランを変更（開発用セルフサービス） */
  async updatePlan(plan: UserPlan): Promise<boolean> {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
    if (!apiBaseUrl) return false

    try {
      const token = await getIdToken()
      if (!token) return false

      const res = await fetch(`${apiBaseUrl}/usage`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ plan }),
      })

      return res.ok
    } catch (error) {
      console.error('[UsageService] プラン変更エラー:', error)
      return false
    }
  }
}

export const usageService = new UsageServiceImpl()
