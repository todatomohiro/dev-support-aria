import { useEffect, useRef, useCallback } from 'react'
import { useAuthStore } from '@/auth/authStore'
import { useAppStore } from '@/stores/appStore'
import { briefingService } from '@/services/briefingService'
import { activityPatternService } from '@/services/activityPatternService'
import { chatController } from '@/services/chatController'

/** 開きっぱなし時のチェック間隔（5分） */
const POLL_INTERVAL_MS = 5 * 60 * 1000

/**
 * プロアクティブ・ブリーフィング hook
 *
 * - 認証完了時: アクティビティパターン + 発火履歴を取得し、条件を満たせばブリーフィングを自動実行
 * - visibilitychange: バックグラウンド復帰時にチェック
 * - setInterval: 開きっぱなし対応（5分ごと）
 *
 * tryBriefing を1箇所に統合し、triggeredRef で実行中の重複を防止する。
 */
export function useBriefing() {
  /** ブリーフィング実行中フラグ（trueの間は新たなトリガーをブロック） */
  const triggeredRef = useRef(false)
  /** パターンロード済みフラグ */
  const patternLoadedRef = useRef(false)
  const authStatus = useAuthStore((s) => s.status)

  const tryBriefing = useCallback(() => {
    // 実行中は新たなトリガーをブロック
    if (triggeredRef.current) return

    const currentAuth = useAuthStore.getState().status
    const { isLoading } = useAppStore.getState()

    console.log(`[Briefing] チェック: auth=${currentAuth}, loading=${isLoading}, hasPattern=${activityPatternService.hasPattern()}, shouldTrigger=${briefingService.shouldTrigger()}`)

    if (currentAuth !== 'authenticated') return
    if (isLoading) return
    if (!briefingService.shouldTrigger()) return

    // markTriggered を先に呼び、メモリキャッシュで即座に重複をブロック
    const currentWindow = activityPatternService.getCurrentWindow()
    briefingService.markTriggered()
    triggeredRef.current = true
    console.log('[Briefing] トリガー実行')

    const { currentLocation } = useAppStore.getState()
    chatController.requestBriefing(currentLocation ?? undefined).then(() => {
      // 成功後にバックエンドに記録（fire-and-forget）
      if (currentWindow) {
        briefingService.recordFired(currentWindow.from, currentWindow.to)
      }
    }).finally(() => {
      triggeredRef.current = false
    })
  }, [])

  // 認証済みになったらパターンをロードしてからブリーフィングをトリガー
  useEffect(() => {
    if (authStatus === 'authenticated') {
      const initTimer = setTimeout(async () => {
        // パターンロードは1セッションにつき1回
        if (!patternLoadedRef.current) {
          patternLoadedRef.current = true
          await activityPatternService.loadPattern()
          await briefingService.loadTodayHistory()
        }
        tryBriefing()
      }, 3000)
      return () => clearTimeout(initTimer)
    }
  }, [authStatus, tryBriefing])

  // visibilitychange + ポーリング
  useEffect(() => {
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
  }, [tryBriefing])
}
