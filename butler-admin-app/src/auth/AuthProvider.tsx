import { useEffect } from 'react'
import { configureAmplify, getAuthUser, getIdToken, listenAuthEvents } from './authClient'
import { useAuthStore } from './authStore'

/** 認証初期化プロバイダー */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setAuthenticated, setUnauthenticated } = useAuthStore()

  useEffect(() => {
    const configured = configureAmplify()
    if (!configured) {
      setUnauthenticated()
      return
    }

    // 初期認証チェック
    const checkAuth = async () => {
      try {
        const user = await getAuthUser()
        const token = await getIdToken()
        setAuthenticated(user, token)
      } catch {
        setUnauthenticated()
      }
    }
    checkAuth()

    // 認証イベント監視
    const unsubscribe = listenAuthEvents(async (event) => {
      if (event === 'signedIn' || event === 'tokenRefresh') {
        try {
          const user = await getAuthUser()
          const token = await getIdToken()
          setAuthenticated(user, token)
        } catch {
          setUnauthenticated()
        }
      } else if (event === 'signedOut') {
        setUnauthenticated()
      }
    })

    return () => unsubscribe()
  }, [setAuthenticated, setUnauthenticated])

  return <>{children}</>
}
