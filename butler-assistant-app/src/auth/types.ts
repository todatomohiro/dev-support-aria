/**
 * 認証状態
 */
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'confirmSignUp'

/**
 * 認証フォームの表示状態
 */
export type AuthView = 'login' | 'signup' | 'confirmSignUp' | 'forgotPassword' | 'confirmForgotPassword' | 'totpChallenge'

/**
 * 認証済みユーザー情報
 */
export interface AuthUser {
  /** Cognito sub（ユーザーID） */
  userId: string
  /** メールアドレス */
  email: string
  /** 表示名 */
  displayName?: string
  /** プロフィール画像 URL */
  avatarUrl?: string
}

/**
 * 認証ストアの状態
 */
export interface AuthState {
  /** 認証状態 */
  status: AuthStatus
  /** 認証済みユーザー */
  user: AuthUser | null
  /** アクセストークン */
  accessToken: string | null
  /** 確認コード送信先メール（サインアップ/パスワードリセット用） */
  pendingEmail: string | null
  /** 管理者権限を持つか */
  isAdmin: boolean
  /** 初期設定が必要か（サーバー側フラグベース） */
  needsOnboarding: boolean

  // アクション
  setStatus: (status: AuthStatus) => void
  setUser: (user: AuthUser | null) => void
  setAccessToken: (token: string | null) => void
  setPendingEmail: (email: string | null) => void
  setIsAdmin: (isAdmin: boolean) => void
  setNeedsOnboarding: (needs: boolean) => void
  login: (user: AuthUser, token: string) => void
  logout: () => void
}

/**
 * Cognito 設定
 */
export interface CognitoConfig {
  userPoolId: string
  clientId: string
  region: string
}
