/** フレンドコード（旧名、互換用エクスポート） */
export interface FriendCode {
  code: string
  expiresAt: number
}

/** フレンドリンク */
export interface FriendLink {
  friendUserId: string
  displayName: string
  linkedAt: number
}

/** グループサマリー（一覧表示用） */
export interface GroupSummary {
  groupId: string
  groupName: string
  lastMessage: string
  updatedAt: number
}

/** グループメッセージ */
export interface GroupMessage {
  id: string
  senderId: string
  senderName: string
  content: string
  timestamp: number
  type: 'text' | 'system'
}

/** グループメンバー */
export interface GroupMember {
  userId: string
  nickname: string
}

/** WebSocket 接続ステータス */
export type WsStatus = 'disconnected' | 'connecting' | 'open' | 'failed'

/** @deprecated ConversationSummary は GroupSummary に移行 */
export type ConversationSummary = GroupSummary

/** @deprecated ConversationMessage は GroupMessage に移行 */
export type ConversationMessage = GroupMessage
