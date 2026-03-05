import { useEffect, useRef, useCallback } from 'react'
import { themeService } from '@/services/themeService'
import { useThemeStore } from '@/stores/themeStore'

/** ポーリング間隔（ミリ秒） */
const POLL_INTERVAL = 10_000

/**
 * テーマメッセージのポーリングフック
 *
 * 指定されたテーマ ID の新着メッセージを定期的にポーリングする。
 * ページがバックグラウンドに移行するとポーリングを一時停止し、
 * フォアグラウンドに復帰すると即座にフェッチしてから再開する。
 * 送信中はポーリングをスキップして競合を防ぐ。
 */
export function useThemePolling(themeId: string | null): void {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isMountedRef = useRef(true)

  /**
   * サーバーからメッセージを取得して差分があれば更新
   */
  const fetchMessages = useCallback(async () => {
    if (!themeId || !isMountedRef.current) return

    // 送信中はスキップ（楽観的更新と競合するのを防止）
    if (useThemeStore.getState().isSending) return

    try {
      const serverMessages = await themeService.listMessages(themeId)
      if (!isMountedRef.current) return

      const currentMessages = useThemeStore.getState().activeMessages
      // メッセージ数が増えた場合のみ更新（自分の送信分も含まれる）
      if (serverMessages.length > currentMessages.length) {
        useThemeStore.getState().setActiveMessages(serverMessages)
      }
    } catch (error) {
      console.warn('[useThemePolling] ポーリングエラー:', error)
    }
  }, [themeId])

  /** ポーリング開始 */
  const startPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }
    intervalRef.current = setInterval(fetchMessages, POLL_INTERVAL)
  }, [fetchMessages])

  /** ポーリング停止 */
  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  // themeId が変わったらポーリングを開始/停止
  useEffect(() => {
    isMountedRef.current = true

    if (!themeId) {
      stopPolling()
      return
    }

    startPolling()

    return () => {
      isMountedRef.current = false
      stopPolling()
    }
  }, [themeId, startPolling, stopPolling])

  // visibilitychange でポーリングを一時停止/再開
  useEffect(() => {
    if (!themeId) return

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling()
      } else {
        fetchMessages()
        startPolling()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [themeId, fetchMessages, startPolling, stopPolling])
}
