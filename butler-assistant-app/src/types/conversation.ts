/** フレンドコード */
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

/** 会話サマリー（一覧表示用） */
export interface ConversationSummary {
  conversationId: string
  otherUserId: string
  otherDisplayName: string
  lastMessage: string
  updatedAt: number
}

/** 会話メッセージ */
export interface ConversationMessage {
  id: string
  senderId: string
  senderName: string
  content: string
  timestamp: number
  type: 'text' | 'system'
}

/** WebSocket 接続ステータス */
export type WsStatus = 'disconnected' | 'connecting' | 'open' | 'failed'
