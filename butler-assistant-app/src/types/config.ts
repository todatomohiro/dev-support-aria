/** LLM モデルキー */
export type ModelKey = 'haiku' | 'sonnet' | 'opus'

/** トピックサブカテゴリ定義 */
export interface TopicSubcategory {
  key: string
  label: string
  /** LLM に注入するカスタムプロンプト（省略時はデフォルト生成） */
  prompt?: string
}

/** トピックカテゴリ定義 */
export interface TopicCategory {
  key: string
  label: string
  description: string
  icon: string
  modelKey: ModelKey
  subcategories?: readonly TopicSubcategory[]
  /** 開発者モード（PoC）のみ表示 */
  developerOnly?: boolean
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
  {
    key: 'aiapp', label: 'AIアプリ開発について', description: 'AIアシスタントアプリの開発相談', icon: '🤖', modelKey: 'sonnet',
    developerOnly: true,
    subcategories: [
      {
        key: 'new_feature', label: '新規機能について',
        prompt: 'ユーザーはLive2D + LLM（Bedrock Claude）+ Amazon Polly TTSを活用したAIアシスタントアプリの新規機能開発について相談しています。\nフロントエンド（React + Vite + TypeScript + Zustand）とバックエンド（AWS CDK + Lambda + DynamoDB + API Gateway）の両面から、実装方針・アーキテクチャ設計・ユーザー体験の観点で具体的なアドバイスを提供してください。\n既存のサービスパターン（インターフェース定義 → Implクラス → シングルトンエクスポート）やコーディング規約に沿った提案を心がけてください。',
      },
      {
        key: 'modify_feature', label: '既存機能改修について',
        prompt: 'ユーザーはLive2D + LLM（Bedrock Claude）+ Amazon Polly TTSを活用したAIアシスタントアプリの既存機能の改修・改善について相談しています。\n現在の実装（3層記憶モデル、トピック管理、スキル連携、フレンド・グループチャット等）を踏まえて、既存コードへの影響範囲を最小化しつつ改修する方法を提案してください。\nバグ修正・リファクタリング・パフォーマンス改善など、具体的なコード変更案を含めて回答してください。',
      },
      {
        key: 'ui_display', label: '画面表示について',
        prompt: 'ユーザーはLive2D + LLM（Bedrock Claude）+ Amazon Polly TTSを活用したAIアシスタントアプリのUI・画面表示について相談しています。\nReact + Tailwind CSSによるコンポーネント設計、レスポンシブ対応（スマホ・デスクトップ）、ダークモード、アニメーション、Live2Dキャラクター表示との共存など、ユーザー体験を重視した具体的なUI改善案を提供してください。\nCapacitor（iOS）のクロスプラットフォーム対応も考慮してください。',
      },
      {
        key: 'ai_technology', label: '技術について',
        prompt: 'ユーザーはLive2D + LLM（Bedrock Claude）+ Amazon Polly TTSを活用したAIアシスタントアプリで使用している技術について相談しています。\nBedrock Converse API・Tool Use、AgentCore Memory、DynamoDB設計、Cognito認証、WebSocket、Lambda最適化、CDKインフラ構成など、AWSサービスやAI技術に関する深い知見をもとに具体的なアドバイスを提供してください。\nベストプラクティスやコスト最適化の観点も含めて回答してください。',
      },
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
  { key: 'haiku', label: 'Normal', description: '日常モード' },
  { key: 'sonnet', label: 'Premium', description: '詳細モード' },
]

export const DEFAULT_MODEL_KEY: ModelKey = 'haiku'

/**
 * モデル参照
 */
export interface ModelReference {
  currentModelId: string
  selectedModelId?: string
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
  sentimentEnabled: boolean
  developerMode: boolean
  /** Live2D キャラクターの表示/非表示 — メインチャット（バッテリー節約用） */
  characterVisible: boolean
  /** Live2D キャラクターの表示/非表示 — トピックチャット */
  themeCharacterVisible: boolean
  /** 生活リズム学習（操作時刻の記録）— デフォルトOFF */
  activityLoggingEnabled: boolean
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
  /** プライベートモード（学習OFF） */
  isPrivate?: boolean
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
  sentimentEnabled: true,
  developerMode: false,
  characterVisible: true,
  themeCharacterVisible: false,
  activityLoggingEnabled: false,
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
