import type { WorkConnection } from '@/types/work'
import { APIError, NetworkError } from '@/types'
import { getIdToken } from '@/auth'

/**
 * ワーク（MCP）サービスのインターフェース
 */
export interface WorkServiceType {
  /** MCP サーバーに接続（コードまたはURL） */
  connect(payload: { code?: string; serverUrl?: string; ttlMinutes?: number; metadata?: Record<string, unknown> }): Promise<WorkConnection>
  /** ワーク接続の状態を取得 */
  getStatus(themeId: string): Promise<WorkConnection>
  /** ワーク接続を切断 */
  disconnect(themeId: string): Promise<void>
}

/**
 * ワーク（MCP）サービス実装
 */
export class WorkServiceImpl implements WorkServiceType {
  /**
   * MCP サーバーに接続（コードまたはURL）
   */
  async connect(payload: { code?: string; serverUrl?: string; ttlMinutes?: number; metadata?: Record<string, unknown> }): Promise<WorkConnection> {
    const data = await this.fetchAPI('/mcp/connect', {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as WorkConnection
    return data
  }

  /**
   * ワーク接続の状態を取得
   */
  async getStatus(themeId: string): Promise<WorkConnection> {
    const data = await this.fetchAPI(`/mcp/status?themeId=${encodeURIComponent(themeId)}`) as Omit<WorkConnection, 'themeId'>
    return { ...data, themeId }
  }

  /**
   * ワーク接続を切断
   */
  async disconnect(themeId: string): Promise<void> {
    await this.fetchAPI(`/mcp/${encodeURIComponent(themeId)}`, { method: 'DELETE' })
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
 * WorkService のシングルトンインスタンス
 */
export const workService: WorkServiceType = new WorkServiceImpl()
