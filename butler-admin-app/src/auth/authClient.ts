import { Amplify } from 'aws-amplify'
import {
  signIn,
  signOut,
  getCurrentUser,
  fetchAuthSession,
  confirmSignIn,
  setUpTOTP,
  verifyTOTPSetup,
  fetchMFAPreference,
  updateMFAPreference,
} from 'aws-amplify/auth'
import { Hub } from 'aws-amplify/utils'

let isConfigured = false

/** Amplify 初期化 */
export function configureAmplify(): boolean {
  if (isConfigured) return true

  const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID
  const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID

  if (!userPoolId || !clientId) return false

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId: clientId,
      },
    },
  })

  isConfigured = true
  return true
}

/** ログイン */
export async function login(email: string, password: string) {
  return signIn({ username: email, password })
}

/** TOTP コード確認（ログイン時の MFA チャレンジ） */
export async function confirmMfaCode(code: string) {
  return confirmSignIn({ challengeResponse: code })
}

/** ログアウト */
export async function logout() {
  return signOut()
}

/** 現在の認証ユーザー取得 */
export async function getAuthUser() {
  const user = await getCurrentUser()
  const session = await fetchAuthSession()
  const payload = session.tokens?.idToken?.payload
  return {
    userId: user.userId,
    email: (payload?.email as string) ?? '',
  }
}

/** ID トークン取得（API Gateway 認証用） */
export async function getIdToken(): Promise<string> {
  const session = await fetchAuthSession()
  return session.tokens?.idToken?.toString() ?? ''
}

/** TOTP セットアップ開始（QR コード用の URI を返す） */
export async function setupTotp(email: string) {
  const output = await setUpTOTP()
  const setupUri = output.getSetupUri('Butler Admin', email)
  return {
    sharedSecret: output.sharedSecret,
    qrCodeUri: setupUri.toString(),
  }
}

/** TOTP セットアップ検証 + 有効化 */
export async function verifyAndEnableTotp(code: string) {
  await verifyTOTPSetup({ code })
  await updateMFAPreference({ totp: 'PREFERRED' })
}

/** MFA（TOTP）が有効かチェック */
export async function checkMfaEnabled(): Promise<boolean> {
  const prefs = await fetchMFAPreference()
  return prefs.enabled?.includes('TOTP') ?? false
}

/** 認証イベントリスナー */
export function listenAuthEvents(callback: (event: string) => void) {
  return Hub.listen('auth', ({ payload }) => {
    callback(payload.event)
  })
}
