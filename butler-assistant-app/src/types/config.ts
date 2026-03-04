/** LLM モデルキー */
export type ModelKey = 'haiku' | 'sonnet' | 'opus'

/** トピックサブカテゴリ定義 */
export interface TopicSubcategory {
  key: string
  label: string
}

/** トピックカテゴリ定義 */
export interface TopicCategory {
  key: string
  label: string
  description: string
  icon: string
  modelKey: ModelKey
  subcategories?: readonly TopicSubcategory[]
}

/** トピックカテゴリプリセット */
export const TOPIC_CATEGORIES: readonly TopicCategory[] = [
  { key: 'free', label: '自由に相談', description: '何でも気軽に聞いてね', icon: '💬', modelKey: 'haiku' },
  {
    key: 'life', label: '生活について', description: '日常の悩み・暮らしの相談', icon: '🏠', modelKey: 'sonnet',
    subcategories: [
      { key: 'cleaning', label: 'お掃除' },
      { key: 'appliances', label: '電化製品' },
      { key: 'cooking', label: '料理' },
      { key: 'health', label: '健康' },
      { key: 'childcare', label: '育児' },
      { key: 'relationships', label: '人間関係' },
    ],
  },
  {
    key: 'dev', label: '開発について', description: 'プログラミング・技術の相談', icon: '💻', modelKey: 'sonnet',
    subcategories: [
      { key: 'development', label: '開発について' },
      { key: 'design', label: '設計について' },
      { key: 'technology', label: '技術について' },
    ],
  },
]

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
  /** トピックカテゴリ */
  category?: string
  /** トピックサブカテゴリ */
  subcategory?: string
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
