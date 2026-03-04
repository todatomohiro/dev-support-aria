/** LLM モデルキー */
export type ModelKey = 'haiku' | 'sonnet' | 'opus'

/** モデル表示情報 */
export interface ModelInfo {
  key: ModelKey
  label: string
  description: string
}

export const AVAILABLE_MODELS: readonly ModelInfo[] = [
  { key: 'haiku', label: 'Haiku', description: '高速・低コスト' },
  { key: 'sonnet', label: 'Sonnet', description: 'バランス型' },
  { key: 'opus', label: 'Opus', description: '高性能' },
]

export const DEFAULT_MODEL_KEY: ModelKey = 'haiku'

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
  ttsEnabled: boolean
  cameraEnabled: boolean
  geolocationEnabled: boolean
  developerMode: boolean
}

/**
 * ユーザーの現在地
 */
export interface UserLocation {
  lat: number
  lng: number
}

/**
 * ユーザープロフィール
 */
export interface UserProfile {
  nickname: string
  honorific: '' | 'さん' | 'くん' | '様'
  gender: '' | 'female' | 'male'
  aiName: string
}

/**
 * アプリケーション設定
 */
export interface AppConfig {
  model: ModelReference
  ui: UIConfig
  profile: UserProfile
}

/**
 * テーマセッション
 */
export interface ThemeSession {
  themeId: string
  themeName: string
  createdAt: string
  updatedAt: string
  /** LLM モデルキー */
  modelKey?: ModelKey
  /** ワーク（MCP接続）がアクティブか */
  workActive?: boolean
  /** ワーク有効期限 */
  workExpiresAt?: string
}

/**
 * デフォルトのUI設定
 */
export const DEFAULT_UI_CONFIG: UIConfig = {
  theme: 'light',
  fontSize: 14,
  characterSize: 100,
  ttsEnabled: false,
  cameraEnabled: false,
  geolocationEnabled: false,
  developerMode: false,
}

/**
 * デフォルトのユーザープロフィール
 */
export const DEFAULT_USER_PROFILE: UserProfile = {
  nickname: '',
  honorific: '',
  gender: '',
  aiName: '',
}
