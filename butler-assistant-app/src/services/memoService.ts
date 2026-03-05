import { APIError, NetworkError } from '@/types'
import { getIdToken } from '@/auth'

/** メモデータ型 */
export interface Memo {
  memoId: string
  title: string
  content: string
  tags: string[]
  source: 'chat' | 'quick'
  createdAt: string
}

/**
 * メモサービスのインターフェース
 */
export interface MemoServiceType {
  /** メモ一覧を取得 */
  listMemos(query?: string): Promise<{ memos: Memo[]; total: number }>
  /** メモを保存（クイック保存） */
  saveMemo(title: string, content: string, tags?: string[], source?: 'chat' | 'quick'): Promise<{ memoId: string }>
  /** メモを削除 */
  deleteMemo(memoId: string): Promise<void>
}

/**
 * メモサービス実装
 */
export class MemoServiceImpl implements MemoServiceType {
  /**
   * メモ一覧を取得
   */
  async listMemos(query?: string): Promise<{ memos: Memo[]; total: number }> {
    const params = new URLSearchParams()
    if (query) params.set('query', query)
    const qs = params.toString()
    const data = await this.fetchAPI(`/memos${qs ? `?${qs}` : ''}`) as { memos: Memo[]; total: number }
    return data
  }

  /**
   * メモを保存
   */
  async saveMemo(title: string, content: string, tags?: string[], source: 'chat' | 'quick' = 'quick'): Promise<{ memoId: string }> {
    const data = await this.fetchAPI('/memos', {
      method: 'POST',
      body: JSON.stringify({ title, content, tags: tags ?? [], source }),
    }) as { memoId: string }
    return data
  }

  /**
   * メモを削除
   */
  async deleteMemo(memoId: string): Promise<void> {
    await this.fetchAPI(`/memos/${memoId}`, { method: 'DELETE' })
  }

  /**
   * API 共通リクエスト
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
        const body = await res.text().catch(() => '')
        if (res.status === 401 || res.status === 403) {
          throw new APIError('認証エラーです。再ログインしてください。', res.status)
        }
        throw new APIError(`APIエラー（${res.status}）: ${body}`, res.status)
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

/** メモサービスのシングルトンインスタンス */
export const memoService: MemoServiceType = new MemoServiceImpl()
