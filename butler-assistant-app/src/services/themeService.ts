import type { ThemeSession } from '@/types'
import { APIError, NetworkError } from '@/types'
import { getIdToken } from '@/auth'

/**
 * テーマサービスのインターフェース
 */
export interface ThemeServiceType {
  /** テーマ一覧を取得 */
  listThemes(): Promise<ThemeSession[]>
  /** テーマを作成 */
  createTheme(themeName: string): Promise<{ themeId: string; themeName: string }>
  /** テーマを削除 */
  deleteTheme(themeId: string): Promise<void>
}

/**
 * テーマサービス実装
 */
export class ThemeServiceImpl implements ThemeServiceType {
  /**
   * テーマ一覧を取得
   */
  async listThemes(): Promise<ThemeSession[]> {
    const data = await this.fetchAPI('/themes') as { themes: ThemeSession[] }
    return data.themes
  }

  /**
   * テーマを作成
   */
  async createTheme(themeName: string): Promise<{ themeId: string; themeName: string }> {
    const data = await this.fetchAPI('/themes', {
      method: 'POST',
      body: JSON.stringify({ themeName }),
    }) as { themeId: string; themeName: string }
    return data
  }

  /**
   * テーマを削除
   */
  async deleteTheme(themeId: string): Promise<void> {
    await this.fetchAPI(`/themes/${themeId}`, { method: 'DELETE' })
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
 * ThemeService のシングルトンインスタンス
 */
export const themeService: ThemeServiceType = new ThemeServiceImpl()
