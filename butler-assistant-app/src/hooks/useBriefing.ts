import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/auth/authStore'
import { useAppStore } from '@/stores/appStore'
import { briefingService } from '@/services/briefingService'
import { chatController } from '@/services/chatController'

/** 開きっぱなし時のチェック間隔（30分） */
const POLL_INTERVAL_MS = 30 * 60 * 1000

/**
 * プロアクティブ・ブリーフィング hook
 *
 * - 認証完了時: 条件を満たせばブリーフィングを自動実行
 * - visibilitychange: バックグラウンド復帰時にチェック
 * - setInterval: 開きっぱなし対応（30分ごと）
 */
export function useBriefing() {
  const triggeredRef = useRef(false)
  const authStatus = useAuthStore((s) => s.status)

  useEffect(() => {
    const tryBriefing = () => {
      if (triggeredRef.current) return

      const currentAuth = useAuthStore.getState().status
      const { isLoading } = useAppStore.getState()

      console.log(`[Briefing] チェック: auth=${currentAuth}, loading=${isLoading}, shouldTrigger=${briefingService.shouldTrigger()}`)

      if (currentAuth !== 'authenticated') return
      if (isLoading) return
      if (!briefingService.shouldTrigger()) return

      console.log('[Briefing] トリガー実行')
      triggeredRef.current = true
      briefingService.markTriggered()

      const { currentLocation } = useAppStore.getState()
      chatController.requestBriefing(currentLocation ?? undefined).finally(() => {
        triggeredRef.current = false
      })
    }

    // 認証済みになったら少し待ってからトリガー
    if (authStatus === 'authenticated') {
      const initTimer = setTimeout(tryBriefing, 3000)
      return () => clearTimeout(initTimer)
    }
  }, [authStatus])

  // visibilitychange + ポーリング（認証状態に依存しない）
  useEffect(() => {
    const tryBriefing = () => {
      if (triggeredRef.current) return
      const currentAuth = useAuthStore.getState().status
      const { isLoading } = useAppStore.getState()
      if (currentAuth !== 'authenticated') return
      if (isLoading) return
      if (!briefingService.shouldTrigger()) return

      console.log('[Briefing] トリガー実行（復帰/ポーリング）')
      triggeredRef.current = true
      briefingService.markTriggered()

      const { currentLocation } = useAppStore.getState()
      chatController.requestBriefing(currentLocation ?? undefined).finally(() => {
        triggeredRef.current = false
      })
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        setTimeout(tryBriefing, 1000)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    const pollTimer = setInterval(tryBriefing, POLL_INTERVAL_MS)

    return () => {
      clearInterval(pollTimer)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])
}
