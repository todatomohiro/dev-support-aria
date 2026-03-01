import type { GroupSummary, GroupMessage, GroupMember } from '@/types'
import { APIError, NetworkError } from '@/types'
import { getIdToken } from '@/auth'

/**
 * グループサービスのインターフェース
 */
export interface GroupServiceType {
  /** グループ一覧を取得 */
  listGroups(): Promise<GroupSummary[]>
  /** グループを作成 */
  createGroup(groupName: string): Promise<{ groupId: string; groupName: string }>
  /** グループのメッセージを取得 */
  getMessages(groupId: string, limit?: number, before?: string): Promise<{ messages: GroupMessage[]; nextCursor?: string }>
  /** メッセージを送信 */
  sendMessage(groupId: string, content: string, senderName: string): Promise<GroupMessage>
  /** 新着メッセージをポーリング */
  pollNewMessages(groupId: string, afterTimestamp: number): Promise<GroupMessage[]>
  /** 既読位置を更新 */
  markAsRead(groupId: string, lastReadAt: number): Promise<void>
  /** メンバーを追加 */
  addMember(groupId: string, params: { userId?: string; userCode?: string }): Promise<{ userId: string; nickname: string }>
  /** グループを退出 */
  leaveGroup(groupId: string): Promise<void>
  /** メンバー一覧を取得 */
  getMembers(groupId: string): Promise<{ members: GroupMember[]; groupName: string }>
}

/**
 * グループサービス実装
 */
export class GroupServiceImpl implements GroupServiceType {
  /**
   * グループ一覧を取得
   */
  async listGroups(): Promise<GroupSummary[]> {
    const data = await this.fetchAPI('/groups') as { conversations: GroupSummary[] }
    return data.conversations
  }

  /**
   * グループを作成
   */
  async createGroup(groupName: string): Promise<{ groupId: string; groupName: string }> {
    const data = await this.fetchAPI('/groups', {
      method: 'POST',
      body: JSON.stringify({ groupName }),
    }) as { groupId: string; groupName: string }
    return data
  }

  /**
   * グループのメッセージを取得
   */
  async getMessages(groupId: string, limit?: number, before?: string): Promise<{ messages: GroupMessage[]; nextCursor?: string }> {
    const params = new URLSearchParams()
    if (limit) params.set('limit', String(limit))
    if (before) params.set('before', before)
    const query = params.toString()
    const path = `/groups/${groupId}/messages${query ? `?${query}` : ''}`
    const data = await this.fetchAPI(path) as { messages: GroupMessage[]; nextCursor?: string }
    // API は新しい順で返すため、表示用に古い順へ反転
    return { ...data, messages: data.messages.reverse() }
  }

  /**
   * メッセージを送信
   */
  async sendMessage(groupId: string, content: string, senderName: string): Promise<GroupMessage> {
    const data = await this.fetchAPI(`/groups/${groupId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, senderName }),
    }) as { message: GroupMessage }
    return data.message
  }

  /**
   * 新着メッセージをポーリング
   */
  async pollNewMessages(groupId: string, afterTimestamp: number): Promise<GroupMessage[]> {
    const params = new URLSearchParams({ after: String(afterTimestamp) })
    const data = await this.fetchAPI(`/groups/${groupId}/messages/new?${params.toString()}`) as { messages: GroupMessage[] }
    return data.messages
  }

  /**
   * 既読位置を更新
   */
  async markAsRead(groupId: string, lastReadAt: number): Promise<void> {
    await this.fetchAPI(`/groups/${groupId}/messages/read`, {
      method: 'POST',
      body: JSON.stringify({ lastReadAt }),
    })
  }

  /**
   * メンバーを追加
   */
  async addMember(groupId: string, params: { userId?: string; userCode?: string }): Promise<{ userId: string; nickname: string }> {
    const data = await this.fetchAPI(`/groups/${groupId}/members`, {
      method: 'POST',
      body: JSON.stringify(params),
    }) as { userId: string; nickname: string }
    return data
  }

  /**
   * グループを退出
   */
  async leaveGroup(groupId: string): Promise<void> {
    await this.fetchAPI(`/groups/${groupId}/members/me`, { method: 'DELETE' })
  }

  /**
   * メンバー一覧を取得
   */
  async getMembers(groupId: string): Promise<{ members: GroupMember[]; groupName: string }> {
    const data = await this.fetchAPI(`/groups/${groupId}/members`) as { members: GroupMember[]; groupName: string }
    return data
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
 * GroupService のシングルトンインスタンス
 */
export const groupService: GroupServiceType = new GroupServiceImpl()
