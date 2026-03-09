import type { MapData } from './response'

/**
 * チャットメッセージ
 */
export interface Message {
  id: string
  role: 'user' | 'assistant' | 'transcript'
  content: string
  timestamp: number
  motion?: string
  /** ユーザーが送信した画像（base64） */
  imageBase64?: string
  /** LLM が返した StructuredResponse の JSON 文字列（開発者モード表示用） */
  rawResponse?: string
  /** 場所検索結果の地図データ */
  mapData?: MapData
  /** LLM が提案するテーマ別ノート */
  suggestedTheme?: { themeName: string }
  /** LLM が提案する回答候補（クイックリプライ） */
  suggestedReplies?: string[]
  /** トランスクリプトエントリ（role='transcript' 時） */
  transcriptEntries?: TranscriptEntry[]
}

/** 会議文字起こしの1エントリ */
export interface TranscriptEntry {
  speaker: string
  text: string
  timestamp: number
  source: string
}

/**
 * 会話履歴
 */
export interface ConversationHistory {
  messages: Message[]
  maxLength: number
}
