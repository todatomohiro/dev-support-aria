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
  developerMode: boolean
}

/**
 * ユーザープロフィール
 */
export interface UserProfile {
  nickname: string
  honorific: '' | 'さん' | 'くん' | '様'
  gender: '' | 'female' | 'male'
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
 * デフォルトのUI設定
 */
export const DEFAULT_UI_CONFIG: UIConfig = {
  theme: 'light',
  fontSize: 14,
  characterSize: 100,
  ttsEnabled: false,
  cameraEnabled: false,
  developerMode: false,
}

/**
 * デフォルトのユーザープロフィール
 */
export const DEFAULT_USER_PROFILE: UserProfile = {
  nickname: '',
  honorific: '',
  gender: '',
}
