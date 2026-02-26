/**
 * チャットメッセージ
 */
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  motion?: string
}

/**
 * 会話履歴
 */
export interface ConversationHistory {
  messages: Message[]
  maxLength: number
}
