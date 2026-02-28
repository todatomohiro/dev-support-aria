import { useEffect, useRef, useCallback } from 'react'
import { groupService } from '@/services/groupService'
import { useGroupChatStore } from '@/stores/groupChatStore'

/** ポーリング間隔（ミリ秒） */
const POLL_INTERVAL = 7000

/**
 * グループメッセージのポーリングフック
 *
 * 指定されたグループ ID の新着メッセージを定期的にポーリングする。
 * ページがバックグラウンドに移行するとポーリングを一時停止し、
 * フォアグラウンドに復帰すると即座にフェッチしてから再開する。
 */
export function useGroupPolling(groupId: string | null): void {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isMountedRef = useRef(true)

  /**
   * 新着メッセージを取得してストアに追加
   */
  const fetchNewMessages = useCallback(async () => {
    if (!groupId || !isMountedRef.current) return

    const lastPollTimestamp = useGroupChatStore.getState().lastPollTimestamp
    if (lastPollTimestamp === null) return

    try {
      const newMessages = await groupService.pollNewMessages(groupId, lastPollTimestamp)
      if (!isMountedRef.current) return

      if (newMessages.length > 0) {
        useGroupChatStore.getState().appendMessages(newMessages)
        const maxTimestamp = Math.max(...newMessages.map((m) => m.timestamp))
        useGroupChatStore.getState().setLastPollTimestamp(maxTimestamp)
      }
    } catch (error) {
      console.error('[useGroupPolling] ポーリングエラー:', error)
    }
  }, [groupId])

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

  // groupId が変わったらポーリングを開始/停止
  useEffect(() => {
    isMountedRef.current = true

    if (!groupId) {
      stopPolling()
      return
    }

    startPolling()

    return () => {
      isMountedRef.current = false
      stopPolling()
    }
  }, [groupId, startPolling, stopPolling])

  // visibilitychange でポーリングを一時停止/再開
  useEffect(() => {
    if (!groupId) return

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
  }, [groupId, fetchNewMessages, startPolling, stopPolling])
}
