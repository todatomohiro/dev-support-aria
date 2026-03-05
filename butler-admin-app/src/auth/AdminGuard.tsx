import { useEffect, useState } from 'react'
import { useAuthStore } from './authStore'
import { adminApi } from '@/services/adminApi'
import { logout } from './authClient'

type GuardState = 'loading' | 'admin' | 'denied' | 'unauthenticated'

/**
 * 管理者権限ガード
 * admin ロール確認後にのみ children を描画
 */
export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { status, idToken } = useAuthStore()
  const [guardState, setGuardState] = useState<GuardState>('loading')

  useEffect(() => {
    if (status === 'loading') return
    if (status === 'unauthenticated') {
      setGuardState('unauthenticated')
      return
    }
    if (!idToken) return

    const checkRole = async () => {
      try {
        const me = await adminApi.getMe(idToken)
        setGuardState(me.role === 'admin' ? 'admin' : 'denied')
      } catch {
        setGuardState('denied')
      }
    }
    checkRole()
  }, [status, idToken])

  if (guardState === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">読み込み中...</div>
      </div>
    )
  }

  if (guardState === 'unauthenticated') {
    return null // LoginPage が表示される
  }

  if (guardState === 'denied') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <div className="text-xl font-bold text-red-600">権限がありません</div>
        <p className="text-gray-600">管理者権限が必要です。</p>
        <button
          onClick={() => logout()}
          className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 cursor-pointer"
        >
          ログアウト
        </button>
      </div>
    )
  }

  return <>{children}</>
}
