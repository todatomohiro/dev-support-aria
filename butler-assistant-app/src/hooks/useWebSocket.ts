import { useEffect, useRef } from 'react'
import { wsService } from '@/services/wsService'
import { useAuthStore } from '@/auth/authStore'

/**
 * 接続参照カウント（複数コンポーネントから同時に呼ばれても安全に管理）
 */
let connectionRefCount = 0

/**
 * WebSocket 接続管理フック
 *
 * マウント時に WebSocket 接続を開始し、全利用コンポーネントがアンマウントされたら切断する。
 * groupId が指定されている場合は、そのグループを購読する。
 */
export function useWebSocket(groupId: string | null): void {
  const accessToken = useAuthStore((s) => s.accessToken)
  const prevTokenRef = useRef<string | null>(null)

  // WebSocket 接続のライフサイクル管理（参照カウント方式）
  useEffect(() => {
    if (!accessToken) return

    connectionRefCount++
    wsService.connect(accessToken)
    prevTokenRef.current = accessToken

    return () => {
      connectionRefCount--
      if (connectionRefCount === 0) {
        wsService.disconnect()
      }
    }
  }, [accessToken])

  // グループの購読管理
  useEffect(() => {
    if (!groupId) return

    wsService.subscribe(groupId)

    return () => {
      wsService.unsubscribe(groupId)
    }
  }, [groupId])
}
