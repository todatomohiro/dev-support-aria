import type { FriendLink } from '@/types'
import { APIError, NetworkError } from '@/types'
import { getIdToken } from '@/auth'

/**
 * フレンドサービスのインターフェース
 */
export interface FriendServiceType {
  /** フレンドコードを生成 */
  generateCode(): Promise<{ code: string }>
  /** 現在のフレンドコードを取得 */
  getCode(): Promise<{ code: string | null }>
  /** ユーザーコードでフレンドリンク */
  linkByCode(code: string, displayName: string): Promise<{ friendUserId: string }>
  /** フレンド一覧を取得 */
  listFriends(): Promise<FriendLink[]>
  /** フレンドを解除 */
  unfriend(friendUserId: string): Promise<void>
}

/**
 * フレンドサービス実装
 */
export class FriendServiceImpl implements FriendServiceType {
  /**
   * フレンドコードを生成
   */
  async generateCode(): Promise<{ code: string }> {
    const data = await this.fetchAPI('/friends/code', { method: 'POST' }) as { code: string }
    return data
  }

  /**
   * 現在のフレンドコードを取得
   */
  async getCode(): Promise<{ code: string | null }> {
    const data = await this.fetchAPI('/friends/code') as { code: string | null }
    return data
  }

  /**
   * ユーザーコードでフレンドリンク
   */
  async linkByCode(code: string, displayName: string): Promise<{ friendUserId: string }> {
    const data = await this.fetchAPI('/friends/link', {
      method: 'POST',
      body: JSON.stringify({ code, displayName }),
    }) as { friendUserId: string }
    return data
  }

  /**
   * フレンド一覧を取得
   */
  async listFriends(): Promise<FriendLink[]> {
    const data = await this.fetchAPI('/friends') as { friends: FriendLink[] }
    return data.friends
  }

  /**
   * フレンドを解除
   */
  async unfriend(friendUserId: string): Promise<void> {
    await this.fetchAPI(`/friends/${friendUserId}`, { method: 'DELETE' })
  }

  /**
   * API ヘルパー
   */
  private async fetchAPI(path: string, options?: RequestInit): Promise<unknown> {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
    const accessToken = await getIdToken()

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
 * FriendService のシングルトンインスタンス
 */
export const friendService: FriendServiceType = new FriendServiceImpl()
