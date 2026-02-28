import { useEffect } from 'react'
import { wsService } from '@/services/wsService'
import { useAuthStore } from '@/auth/authStore'

/**
 * WebSocket 接続管理フック
 *
 * マウント時に WebSocket 接続を開始し、アンマウント時に切断する。
 * conversationId が指定されている場合は、その会話を購読する。
 */
export function useWebSocket(conversationId: string | null): void {
  const accessToken = useAuthStore((s) => s.accessToken)

  // WebSocket 接続のライフサイクル管理
  useEffect(() => {
    if (!accessToken) return

    wsService.connect(accessToken)

    return () => {
      wsService.disconnect()
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
