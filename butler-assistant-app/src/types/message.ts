/**
 * チャットメッセージ
 */
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  motion?: string
  /** LLM が返した StructuredResponse の JSON 文字列（開発者モード表示用） */
  rawResponse?: string
}

/**
 * 会話履歴
 */
export interface ConversationHistory {
  messages: Message[]
  maxLength: number
}
