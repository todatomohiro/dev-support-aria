/**
 * 感情タイプ
 */
export type EmotionType = 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'thinking' | 'embarrassed' | 'excited'

/** 地図マーカー */
export interface MapMarker {
  lat: number
  lng: number
  title: string
  address?: string
  rating?: number
}

/** 地図データ */
export interface MapData {
  center: { lat: number; lng: number }
  zoom: number
  markers: MapMarker[]
}

/**
 * LLMからの構造化レスポンス（JSON形式）
 */
export interface StructuredResponse {
  text: string
  motion: string
  emotion?: EmotionType
  mapData?: MapData
  /** LLM が提案するテーマ別ノート（メイン会話で深い話題が検出された場合） */
  suggestedTheme?: { themeName: string }
  /** Lambda から返されたセッション要約（開発者モード表示用） */
  sessionSummary?: string
  /** Lambda から返された永久記憶（開発者モード表示用） */
  permanentFacts?: string[]
  /** Lambda から返されたトピック自動命名（新規トピック時） */
  themeName?: string
  /** Lambda から返されたワーク（MCP）接続状態 */
  workStatus?: { active: boolean; expiresAt: string; toolCount: number }
}

/**
 * 解析済みレスポンス
 */
export interface ParsedResponse {
  text: string
  motion: string
  emotion?: EmotionType
  mapData?: MapData
  isValid: boolean
  errors?: string[]
}

/**
 * バリデーション結果
 */
export interface ValidationResult {
  isValid: boolean
  errors: FieldValidationError[]
}

export interface FieldValidationError {
  field: string
  message: string
}
