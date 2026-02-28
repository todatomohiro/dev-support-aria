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
 * conversationId が指定されている場合は、その会話を購読する。
 */
export function useWebSocket(conversationId: string | null): void {
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

  // 会話の購読管理
  useEffect(() => {
    if (!conversationId) return

    wsService.subscribe(conversationId)

    return () => {
      wsService.unsubscribe(conversationId)
    }
  }, [conversationId])
}
