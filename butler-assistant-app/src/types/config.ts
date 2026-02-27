/**
 * LLMプロバイダー
 */
export type LLMProvider = 'gemini' | 'claude'

/**
 * LLM設定
 */
export interface LLMConfig {
  provider: LLMProvider
  apiKey: string
  systemPrompt: string
  temperature: number
  maxTokens: number
}

/**
 * モデル参照
 */
export interface ModelReference {
  currentModelId: string
}

/**
 * UI設定
 */
export interface UIConfig {
  theme: 'light' | 'dark'
  fontSize: number
  characterSize: number
}

/**
 * アプリケーション設定
 */
export interface AppConfig {
  model: ModelReference
  ui: UIConfig
}

/**
 * デフォルトのUI設定
 */
export const DEFAULT_UI_CONFIG: UIConfig = {
  theme: 'light',
  fontSize: 14,
  characterSize: 100,
}
