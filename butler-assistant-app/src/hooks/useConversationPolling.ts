import { useEffect, useRef, useCallback } from 'react'
import { conversationService } from '@/services/conversationService'
import { useMultiChatStore } from '@/stores/multiChatStore'

/** ポーリング間隔（ミリ秒） */
const POLL_INTERVAL = 7000

/**
 * 会話メッセージのポーリングフック
 *
 * 指定された会話 ID の新着メッセージを定期的にポーリングする。
 * ページがバックグラウンドに移行するとポーリングを一時停止し、
 * フォアグラウンドに復帰すると即座にフェッチしてから再開する。
 */
export function useConversationPolling(conversationId: string | null): void {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isMountedRef = useRef(true)

  /**
   * 新着メッセージを取得してストアに追加
   */
  const fetchNewMessages = useCallback(async () => {
    if (!conversationId || !isMountedRef.current) return

    const lastPollTimestamp = useMultiChatStore.getState().lastPollTimestamp
    if (lastPollTimestamp === null) return

    try {
      const newMessages = await conversationService.pollNewMessages(conversationId, lastPollTimestamp)
      if (!isMountedRef.current) return

      if (newMessages.length > 0) {
        useMultiChatStore.getState().appendMessages(newMessages)
        const maxTimestamp = Math.max(...newMessages.map((m) => m.timestamp))
        useMultiChatStore.getState().setLastPollTimestamp(maxTimestamp)
      }
    } catch (error) {
      console.error('[useConversationPolling] ポーリングエラー:', error)
    }
  }, [conversationId])

  /**
   * ポーリングインターバルを開始
   */
  const startPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }
    intervalRef.current = setInterval(fetchNewMessages, POLL_INTERVAL)
  }, [fetchNewMessages])

  /**
   * ポーリングインターバルを停止
   */
  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  // conversationId が変わったらポーリングを開始/停止
  useEffect(() => {
    isMountedRef.current = true

    if (!conversationId) {
      stopPolling()
      return
    }

    startPolling()

    return () => {
      isMountedRef.current = false
      stopPolling()
    }
  }, [conversationId, startPolling, stopPolling])

  // visibilitychange でポーリングを一時停止/再開
  useEffect(() => {
    if (!conversationId) return

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling()
      } else {
        // フォアグラウンド復帰時は即座にフェッチしてから再開
        fetchNewMessages()
        startPolling()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [conversationId, fetchNewMessages, startPolling, stopPolling])
}
