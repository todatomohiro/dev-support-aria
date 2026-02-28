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
