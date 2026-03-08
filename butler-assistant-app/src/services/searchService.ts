import { APIError, NetworkError } from '@/types'
import { getIdToken } from '@/auth'

/**
 * 検索結果アイテムの型
 */
export interface SearchResultItem {
  type: 'topic' | 'message' | 'memo'
  /** トピック: themeId, メモ: memoId */
  id: string
  /** 表示タイトル */
  title: string
  /** スニペット（メッセージ・メモのみ） */
  snippet?: string
  /** 所属トピック名（メッセージのみ） */
  themeName?: string
  /** 所属トピックID（メッセージのみ） */
  themeId?: string
  /** カテゴリ（トピックのみ） */
  category?: string
  /** タグ（メモのみ） */
  tags?: string[]
  /** 日時（ソート用） */
  timestamp: string
}

/**
 * 検索結果
 */
export interface SearchResult {
  items: SearchResultItem[]
  counts: {
    topics: number
    messages: number
    memos: number
  }
}

/**
 * 検索サービスのインターフェース
 */
export interface SearchServiceType {
  /** キーワードで横断検索 */
  search(query: string): Promise<SearchResult>
}

/**
 * 検索サービス実装
 */
export class SearchServiceImpl implements SearchServiceType {
  /**
   * キーワードで横断検索
   */
  async search(query: string): Promise<SearchResult> {
    const data = await this.fetchAPI(`/search?q=${encodeURIComponent(query)}`) as {
      topics: Array<{ themeId: string; themeName: string; category: string; updatedAt: string }>
      messages: Array<{ themeId: string; themeName: string; role: string; snippet: string; timestamp: string }>
      memos: Array<{ memoId: string; title: string; snippet: string; tags: string[]; createdAt: string }>
    }

    const items: SearchResultItem[] = []

    // トピック
    for (const t of data.topics) {
      items.push({
        type: 'topic',
        id: t.themeId,
        title: t.themeName,
        category: t.category,
        timestamp: t.updatedAt,
      })
    }

    // メッセージ
    for (const m of data.messages) {
      items.push({
        type: 'message',
        id: m.themeId,
        title: m.themeName,
        snippet: m.snippet,
        themeName: m.themeName,
        themeId: m.themeId,
        timestamp: m.timestamp,
      })
    }

    // メモ
    for (const memo of data.memos) {
      items.push({
        type: 'memo',
        id: memo.memoId,
        title: memo.title,
        snippet: memo.snippet,
        tags: memo.tags,
        timestamp: memo.createdAt,
      })
    }

    // 日時降順ソート
    items.sort((a, b) => b.timestamp.localeCompare(a.timestamp))

    return {
      items,
      counts: {
        topics: data.topics.length,
        messages: data.messages.length,
        memos: data.memos.length,
      },
    }
  }

  /**
   * API ヘルパー
   */
  private async fetchAPI(path: string): Promise<unknown> {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
    const accessToken = await getIdToken()

    if (!apiBaseUrl) {
      throw new APIError('API Base URL が設定されていません', 500)
    }

    try {
      const res = await fetch(`${apiBaseUrl}${path}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
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
 * SearchService のシングルトンインスタンス
 */
export const searchService: SearchServiceType = new SearchServiceImpl()
