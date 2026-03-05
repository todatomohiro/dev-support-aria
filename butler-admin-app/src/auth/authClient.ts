import { Amplify } from 'aws-amplify'
import { signIn, signOut, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth'
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

/** 認証イベントリスナー */
export function listenAuthEvents(callback: (event: string) => void) {
  return Hub.listen('auth', ({ payload }) => {
    callback(payload.event)
  })
}
