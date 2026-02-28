import type { SkillConnection } from '@/types'
import { APIError, NetworkError } from '@/types'
import { useAuthStore } from '@/auth/authStore'

/**
 * スキル連携クライアントのインターフェース
 */
export interface SkillClientService {
  /** Google OAuth 認証フローを開始 */
  startGoogleOAuth(): void
  /** 認可コードをバックエンドに送信してトークン交換 */
  exchangeCode(code: string): Promise<void>
  /** 接続済みサービス一覧を取得 */
  getConnections(): Promise<SkillConnection[]>
  /** Google 連携を解除 */
  disconnectGoogle(): Promise<void>
}

/**
 * スキル連携クライアント実装
 */
export class SkillClientImpl implements SkillClientService {
  /**
   * Google OAuth 認証フローを開始（新しいウィンドウを開く）
   */
  startGoogleOAuth(): void {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (!clientId) {
      throw new APIError('Google Client ID が設定されていません', 500)
    }

    const redirectUri = `${window.location.origin}/oauth/callback`
    const scope = 'https://www.googleapis.com/auth/calendar'

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope,
      access_type: 'offline',
      prompt: 'consent',
    })

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
    window.open(authUrl, 'google-oauth', 'width=500,height=700')
  }

  /**
   * 認可コードをバックエンドに送信してトークンに交換
   */
  async exchangeCode(code: string): Promise<void> {
    const redirectUri = `${window.location.origin}/oauth/callback`
    await this.fetchAPI('/skills/google/callback', {
      method: 'POST',
      body: JSON.stringify({ code, redirectUri }),
    })
  }

  /**
   * 接続済みサービス一覧を取得
   */
  async getConnections(): Promise<SkillConnection[]> {
    const data = await this.fetchAPI('/skills/connections') as { connections: SkillConnection[] }
    return data.connections
  }

  /**
   * Google 連携を解除
   */
  async disconnectGoogle(): Promise<void> {
    await this.fetchAPI('/skills/google/disconnect', { method: 'DELETE' })
  }

  /**
   * API ヘルパー
   */
  private async fetchAPI(path: string, options?: RequestInit): Promise<unknown> {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
    const accessToken = useAuthStore.getState().accessToken

    if (!apiBaseUrl) {
      throw new APIError('API Base URL が設定されていません', 500)
    }

    try {
      const res = await fetch(`${apiBaseUrl}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...options?.headers,
        },
      })

      if (!res.ok) {
        const body = await res.text()
        throw new APIError(`API エラー (${res.status}): ${body}`, res.status)
      }

      return await res.json()
    } catch (error) {
      if (error instanceof APIError) throw error
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new NetworkError()
      }
      throw error
    }
  }
}

/**
 * SkillClient のシングルトンインスタンス
 */
export const skillClient: SkillClientService = new SkillClientImpl()
