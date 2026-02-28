import { useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useMultiChatStore } from '@/stores/multiChatStore'
import { conversationService } from '@/services/conversationService'
import { useWebSocket } from '@/hooks/useWebSocket'
import { ConversationList } from './ConversationList'
import { ConversationChat } from './ConversationChat'
import { ParticipantPanel } from './ParticipantPanel'

/** バックグラウンドポーリング間隔（ミリ秒） */
const BACKGROUND_POLL_INTERVAL = 30000

/**
 * マルチチャット画面
 *
 * アクティブな会話が無い場合は会話一覧、ある場合はチャット画面を表示する。
 */
export function MultiChatScreen() {
  const { conversationId: paramConversationId } = useParams<{ conversationId?: string }>()
  const navigate = useNavigate()
  const bgPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevUpdatedAtRef = useRef<Record<string, number>>({})

  // WebSocket 接続（会話一覧レベル — conversation_updated イベント受信用）
  useWebSocket(null)
  const wsStatus = useMultiChatStore((s) => s.wsStatus)

  const activeConversationId = useMultiChatStore((s) => s.activeConversationId)
  const conversations = useMultiChatStore((s) => s.conversations)
  const isLoadingConversations = useMultiChatStore((s) => s.isLoadingConversations)
  const error = useMultiChatStore((s) => s.error)
  const unreadCounts = useMultiChatStore((s) => s.unreadCounts)
  const setConversations = useMultiChatStore((s) => s.setConversations)
  const setActiveConversation = useMultiChatStore((s) => s.setActiveConversation)
  const setLoadingConversations = useMultiChatStore((s) => s.setLoadingConversations)
  const setError = useMultiChatStore((s) => s.setError)
  const incrementUnread = useMultiChatStore((s) => s.incrementUnread)
  const clearUnread = useMultiChatStore((s) => s.clearUnread)

  /** 会話一覧を取得 */
  const loadConversations = useCallback(async () => {
    setLoadingConversations(true)
    setError(null)
    try {
      const result = await conversationService.listConversations()
      setConversations(result)
    } catch (err) {
      console.error('[MultiChatScreen] 会話一覧の取得に失敗:', err)
      setError('会話一覧の取得に失敗しました')
    } finally {
      setLoadingConversations(false)
    }
  }, [setConversations, setLoadingConversations, setError])

  /** バックグラウンドで会話一覧をポーリングし、未読を検知 */
  const pollConversations = useCallback(async () => {
    try {
      const result = await conversationService.listConversations()
      const { activeConversationId: currentActive } = useMultiChatStore.getState()

      for (const conv of result) {
        const prevUpdatedAt = prevUpdatedAtRef.current[conv.conversationId]
        if (prevUpdatedAt !== undefined && conv.updatedAt > prevUpdatedAt && conv.conversationId !== currentActive) {
          incrementUnread(conv.conversationId)
        }
      }

      // updatedAt を記録
      const newMap: Record<string, number> = {}
      for (const conv of result) {
        newMap[conv.conversationId] = conv.updatedAt
      }
      prevUpdatedAtRef.current = newMap

      setConversations(result)
    } catch {
      // バックグラウンドポーリング失敗は無視
    }
  }, [setConversations, incrementUnread])

  // マウント時に会話一覧を取得 + updatedAt を初期化
  useEffect(() => {
    loadConversations().then(() => {
      const convs = useMultiChatStore.getState().conversations
      const map: Record<string, number> = {}
      for (const c of convs) {
        map[c.conversationId] = c.updatedAt
      }
      prevUpdatedAtRef.current = map
    })
  }, [loadConversations])

  // バックグラウンドポーリング（WS 失敗時のフォールバック）
  useEffect(() => {
    if (wsStatus !== 'failed') {
      if (bgPollRef.current) {
        clearInterval(bgPollRef.current)
        bgPollRef.current = null
      }
      return
    }
    bgPollRef.current = setInterval(pollConversations, BACKGROUND_POLL_INTERVAL)
    return () => {
      if (bgPollRef.current) {
        clearInterval(bgPollRef.current)
      }
    }
  }, [wsStatus, pollConversations])

  // URL パラメータから会話 ID を同期
  useEffect(() => {
    if (paramConversationId && paramConversationId !== activeConversationId) {
      setActiveConversation(paramConversationId)
    }
  }, [paramConversationId, activeConversationId, setActiveConversation])

  /** 会話を選択 */
  const handleSelectConversation = useCallback((conversationId: string) => {
    setActiveConversation(conversationId)
    clearUnread(conversationId)
    navigate(`/multi-chat/${conversationId}`)
  }, [setActiveConversation, clearUnread, navigate])

  /** 一覧に戻る */
  const handleBack = useCallback(() => {
    setActiveConversation(null)
    navigate('/multi-chat')
    loadConversations()
  }, [setActiveConversation, navigate, loadConversations])

  // アクティブな会話の相手情報を取得
  const activeConversation = conversations.find((c) => c.conversationId === activeConversationId)

  if (!activeConversationId) {
    return (
      <ConversationList
        conversations={conversations}
        onSelectConversation={handleSelectConversation}
        onRefresh={loadConversations}
        isLoading={isLoadingConversations}
        error={error}
        unreadCounts={unreadCounts}
        wsStatus={wsStatus}
      />
    )
  }

  return (
    <div className="flex flex-1 min-h-0">
      <div className="hidden md:block flex-[1] border-r border-gray-200 dark:border-gray-700 min-w-0">
        <ParticipantPanel
          displayName={activeConversation?.otherDisplayName ?? ''}
        />
      </div>
      <div className="flex-[2] flex flex-col min-h-0 min-w-0">
        <ConversationChat
          conversationId={activeConversationId}
          otherDisplayName={activeConversation?.otherDisplayName ?? ''}
          onBack={handleBack}
        />
      </div>
    </div>
  )
}
