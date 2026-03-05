import { useEffect } from 'react'
import { useAuthStore } from './authStore'
import {
  configureAmplify,
  isAuthConfigured,
  getAuthUser,
  getIdToken,
  checkIsAdmin,
  listenAuthEvents,
} from './authClient'
import { syncService } from '@/services/syncService'

/**
 * 認証プロバイダー
 * セッション復元 + Hub イベント監視 + ログイン時同期トリガー
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { login, logout, setStatus, setIsAdmin } = useAuthStore()

  // 初期化 & セッション復元
  useEffect(() => {
    const restoreSession = async () => {
      // Cognito が未設定ならゲストモードで即完了
      if (!isAuthConfigured()) {
        setStatus('unauthenticated')
        return
      }

      configureAmplify()

      try {
        const user = await getAuthUser()
        const token = await getIdToken()

        if (user && token) {
          login(user, token)
          // ログイン時にサーバーからデータを同期
          await syncService.onLogin(token)
          // admin ロールチェック（fire-and-forget）
          checkIsAdmin(token).then(setIsAdmin)
        } else {
          setStatus('unauthenticated')
        }
      } catch {
        setStatus('unauthenticated')
      }
    }

    restoreSession()
  }, [login, setStatus, setIsAdmin])

  // Hub イベント監視
  useEffect(() => {
    if (!isAuthConfigured()) return

    const unsubscribe = listenAuthEvents(async (event) => {
      switch (event) {
        case 'signedIn':
        case 'tokenRefresh': {
          const user = await getAuthUser()
          const token = await getIdToken()
          if (user && token) {
            login(user, token)
            await syncService.onLogin(token)
            checkIsAdmin(token).then(setIsAdmin)
          }
          break
        }
        case 'signedOut':
          logout()
          syncService.onLogout()
          break
      }
    })

    return unsubscribe
  }, [login, logout])

  return <>{children}</>
}
