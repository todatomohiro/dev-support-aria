import type { ConversationSummary, ConversationMessage } from '@/types'
import { APIError, NetworkError } from '@/types'
import { useAuthStore } from '@/auth/authStore'

/**
 * 会話サービスのインターフェース
 */
export interface ConversationServiceType {
  /** 会話一覧を取得 */
  listConversations(): Promise<ConversationSummary[]>
  /** 会話のメッセージを取得 */
  getMessages(conversationId: string, limit?: number, before?: string): Promise<{ messages: ConversationMessage[]; nextCursor?: string }>
  /** メッセージを送信 */
  sendMessage(conversationId: string, content: string, senderName: string): Promise<ConversationMessage>
  /** 新着メッセージをポーリング */
  pollNewMessages(conversationId: string, afterTimestamp: number): Promise<ConversationMessage[]>
}

/**
 * 会話サービス実装
 */
export class ConversationServiceImpl implements ConversationServiceType {
  /**
   * 会話一覧を取得
   */
  async listConversations(): Promise<ConversationSummary[]> {
    const data = await this.fetchAPI('/conversations') as { conversations: ConversationSummary[] }
    return data.conversations
  }

  /**
   * 会話のメッセージを取得
   */
  async getMessages(conversationId: string, limit?: number, before?: string): Promise<{ messages: ConversationMessage[]; nextCursor?: string }> {
    const params = new URLSearchParams()
    if (limit) params.set('limit', String(limit))
    if (before) params.set('before', before)
    const query = params.toString()
    const path = `/conversations/${conversationId}/messages${query ? `?${query}` : ''}`
    const data = await this.fetchAPI(path) as { messages: ConversationMessage[]; nextCursor?: string }
    return data
  }

  /**
   * メッセージを送信
   */
  async sendMessage(conversationId: string, content: string, senderName: string): Promise<ConversationMessage> {
    const data = await this.fetchAPI(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, senderName }),
    }) as { message: ConversationMessage }
    return data.message
  }

  /**
   * 新着メッセージをポーリング
   */
  async pollNewMessages(conversationId: string, afterTimestamp: number): Promise<ConversationMessage[]> {
    const params = new URLSearchParams({ after: String(afterTimestamp) })
    const data = await this.fetchAPI(`/conversations/${conversationId}/messages/new?${params.toString()}`) as { messages: ConversationMessage[] }
    return data.messages
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
 * ConversationService のシングルトンインスタンス
 */
export const conversationService: ConversationServiceType = new ConversationServiceImpl()
