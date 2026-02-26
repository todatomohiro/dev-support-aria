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
  llm: LLMConfig
  model: ModelReference
  ui: UIConfig
}

/**
 * デフォルトのLLM設定
 */
export const DEFAULT_LLM_CONFIG: LLMConfig = {
  provider: 'gemini',
  apiKey: '',
  systemPrompt: '',
  temperature: 0.7,
  maxTokens: 1024,
}

/**
 * デフォルトのUI設定
 */
export const DEFAULT_UI_CONFIG: UIConfig = {
  theme: 'light',
  fontSize: 14,
  characterSize: 100,
}
