/**
 * 感情タイプ
 */
export type EmotionType = 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'thinking' | 'embarrassed' | 'excited'

/**
 * LLMからの構造化レスポンス（JSON形式）
 */
export interface StructuredResponse {
  text: string
  motion: string
  emotion?: EmotionType
}

/**
 * 解析済みレスポンス
 */
export interface ParsedResponse {
  text: string
  motion: string
  emotion?: EmotionType
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
