/**
 * 使用量管理サービス
 *
 * レートリミット情報の取得・ローカルチェックを行う。
 */
import type { UsageInfo, ModelKey } from '@/types'
import { getIdToken } from '@/auth'

/** 使用量サービスインターフェース */
export interface UsageServiceInterface {
  /** サーバーから使用量情報を取得 */
  fetchUsage(): Promise<UsageInfo | null>
  /** ローカルの使用量情報でメッセージ送信可否をチェック */
  canSendMessage(usageInfo: UsageInfo | null, modelKey: ModelKey): { allowed: boolean; reason?: string }
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

    // 有料プランは無制限
    if (usageInfo.plan === 'paid') return { allowed: true }

    // モデル制限
    if (!usageInfo.allowedModels.includes(modelKey)) {
      return { allowed: false, reason: 'Premium モードは有料プランで利用できます' }
    }

    // 日次制限
    if (usageInfo.daily.remaining <= 0) {
      return { allowed: false, reason: '今日のお話回数の上限に達しました' }
    }

    // 月次制限
    if (usageInfo.monthly.remaining <= 0) {
      return { allowed: false, reason: '今月のお話回数の上限に達しました' }
    }

    return { allowed: true }
  }
}

export const usageService = new UsageServiceImpl()
