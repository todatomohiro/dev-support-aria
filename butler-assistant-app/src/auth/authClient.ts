import { Amplify } from 'aws-amplify'
import {
  signIn,
  signUp,
  confirmSignUp,
  resetPassword,
  confirmResetPassword,
  signOut,
  getCurrentUser,
  fetchAuthSession,
} from 'aws-amplify/auth'
import { Hub } from 'aws-amplify/utils'
import type { AuthUser, CognitoConfig } from './types'

/**
 * Amplify 初期化フラグ
 */
let isConfigured = false

/**
 * Cognito 設定を取得
 */
export function getCognitoConfig(): CognitoConfig {
  return {
    userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID ?? '',
    clientId: import.meta.env.VITE_COGNITO_CLIENT_ID ?? '',
    region: import.meta.env.VITE_AWS_REGION ?? 'ap-northeast-1',
  }
}

/**
 * Amplify を初期化
 */
export function configureAmplify(): void {
  if (isConfigured) return

  const config = getCognitoConfig()
  if (!config.userPoolId || !config.clientId) {
    if (import.meta.env.DEV) {
      console.warn('[Auth] Cognito 設定が未設定です。ゲストモードで動作します。')
    }
    return
  }

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.clientId,
      },
    },
  })

  isConfigured = true
}

/**
 * Cognito が設定済みかどうか
 */
export function isAuthConfigured(): boolean {
  const config = getCognitoConfig()
  return Boolean(config.userPoolId && config.clientId)
}

/**
 * メール/パスワードでログイン
 */
export async function login(email: string, password: string): Promise<{ nextStep: string }> {
  configureAmplify()
  const result = await signIn({ username: email, password })
  return { nextStep: result.nextStep.signInStep }
}

/**
 * アカウント新規登録
 */
export async function signup(email: string, password: string): Promise<{ nextStep: string }> {
  configureAmplify()
  const result = await signUp({
    username: email,
    password,
    options: {
      userAttributes: { email },
    },
  })
  return { nextStep: result.nextStep.signUpStep }
}

/**
 * サインアップ確認コードの検証
 */
export async function confirmSignup(email: string, code: string): Promise<void> {
  await confirmSignUp({ username: email, confirmationCode: code })
}

/**
 * パスワードリセット申請
 */
export async function forgotPassword(email: string): Promise<void> {
  await resetPassword({ username: email })
}

/**
 * パスワードリセット確認（コード + 新パスワード）
 */
export async function confirmForgotPassword(
  email: string,
  code: string,
  newPassword: string
): Promise<void> {
  await confirmResetPassword({ username: email, confirmationCode: code, newPassword })
}

/**
 * ログアウト
 */
export async function logout(): Promise<void> {
  await signOut()
}

/**
 * 現在のユーザー情報を取得
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  try {
    const user = await getCurrentUser()
    const session = await fetchAuthSession()
    const idToken = session.tokens?.idToken

    return {
      userId: user.userId,
      email: idToken?.payload?.email as string ?? '',
      displayName: idToken?.payload?.name as string ?? undefined,
      avatarUrl: idToken?.payload?.picture as string ?? undefined,
    }
  } catch {
    return null
  }
}

/**
 * アクセストークンを取得
 */
export async function getAccessToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession()
    return session.tokens?.accessToken?.toString() ?? null
  } catch {
    return null
  }
}

/**
 * Hub イベントをリッスン（認証状態の変化を監視）
 */
export function listenAuthEvents(callback: (event: string) => void): () => void {
  const unsubscribe = Hub.listen('auth', ({ payload }) => {
    callback(payload.event)
  })
  return unsubscribe
}
