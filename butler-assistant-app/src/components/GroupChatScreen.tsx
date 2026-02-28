import { useEffect, useCallback, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useAppStore } from '@/stores'
import { useGroupChatStore } from '@/stores/groupChatStore'
import { groupService } from '@/services/groupService'
import { useWebSocket } from '@/hooks/useWebSocket'
import { GroupList } from './GroupList'
import { GroupChat } from './GroupChat'
import { GroupInfoPanel } from './GroupInfoPanel'

/** バックグラウンドポーリング間隔（ミリ秒） */
const BACKGROUND_POLL_INTERVAL = 30000

/**
 * グループチャット画面
 *
 * アクティブなグループが無い場合はグループ一覧、ある場合はチャット画面を表示する。
 */
export function GroupChatScreen() {
  const { groupId: paramGroupId } = useParams<{ groupId?: string }>()
  const navigate = useNavigate()
  const bgPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevUpdatedAtRef = useRef<Record<string, number>>({})
  const [showInfoPanel, setShowInfoPanel] = useState(false)

  // ニックネーム
  const nickname = useAppStore((s) => s.config.profile.nickname)

  // WebSocket 接続（グループ一覧レベル — conversation_updated イベント受信用）
  useWebSocket(null)
  const wsStatus = useGroupChatStore((s) => s.wsStatus)

  const activeGroupId = useGroupChatStore((s) => s.activeGroupId)
  const groups = useGroupChatStore((s) => s.groups)
  const isLoadingGroups = useGroupChatStore((s) => s.isLoadingGroups)
  const error = useGroupChatStore((s) => s.error)
  const unreadCounts = useGroupChatStore((s) => s.unreadCounts)
  const setGroups = useGroupChatStore((s) => s.setGroups)
  const setActiveGroup = useGroupChatStore((s) => s.setActiveGroup)
  const setLoadingGroups = useGroupChatStore((s) => s.setLoadingGroups)
  const setError = useGroupChatStore((s) => s.setError)
  const incrementUnread = useGroupChatStore((s) => s.incrementUnread)
  const clearUnread = useGroupChatStore((s) => s.clearUnread)

  /** グループ一覧を取得 */
  const loadGroups = useCallback(async () => {
    setLoadingGroups(true)
    setError(null)
    try {
      const result = await groupService.listGroups()
      setGroups(result)
    } catch (err) {
      console.error('[GroupChatScreen] グループ一覧の取得に失敗:', err)
      setError('グループ一覧の取得に失敗しました')
    } finally {
      setLoadingGroups(false)
    }
  }, [setGroups, setLoadingGroups, setError])

  /** バックグラウンドでグループ一覧をポーリングし、未読を検知 */
  const pollGroups = useCallback(async () => {
    try {
      const result = await groupService.listGroups()
      const { activeGroupId: currentActive } = useGroupChatStore.getState()

      for (const group of result) {
        const prevUpdatedAt = prevUpdatedAtRef.current[group.groupId]
        if (prevUpdatedAt !== undefined && group.updatedAt > prevUpdatedAt && group.groupId !== currentActive) {
          incrementUnread(group.groupId)
        }
      }

      // updatedAt を記録
      const newMap: Record<string, number> = {}
      for (const group of result) {
        newMap[group.groupId] = group.updatedAt
      }
      prevUpdatedAtRef.current = newMap

      setGroups(result)
    } catch {
      // バックグラウンドポーリング失敗は無視
    }
  }, [setGroups, incrementUnread])

  // マウント時にグループ一覧を取得 + updatedAt を初期化
  useEffect(() => {
    loadGroups().then(() => {
      const gs = useGroupChatStore.getState().groups
      const map: Record<string, number> = {}
      for (const g of gs) {
        map[g.groupId] = g.updatedAt
      }
      prevUpdatedAtRef.current = map
    })
  }, [loadGroups])

  // バックグラウンドポーリング（WS 失敗時のフォールバック）
  useEffect(() => {
    if (wsStatus !== 'failed') {
      if (bgPollRef.current) {
        clearInterval(bgPollRef.current)
        bgPollRef.current = null
      }
      return
    }
    bgPollRef.current = setInterval(pollGroups, BACKGROUND_POLL_INTERVAL)
    return () => {
      if (bgPollRef.current) {
        clearInterval(bgPollRef.current)
      }
    }
  }, [wsStatus, pollGroups])

  // URL パラメータからグループ ID を同期
  useEffect(() => {
    if (paramGroupId && paramGroupId !== activeGroupId) {
      setActiveGroup(paramGroupId)
    }
  }, [paramGroupId, activeGroupId, setActiveGroup])

  /** グループを選択 */
  const handleSelectGroup = useCallback((groupId: string) => {
    setActiveGroup(groupId)
    clearUnread(groupId)
    setShowInfoPanel(false)
    navigate(`/groups/${groupId}`)
  }, [setActiveGroup, clearUnread, navigate])

  /** 一覧に戻る */
  const handleBack = useCallback(() => {
    setActiveGroup(null)
    setShowInfoPanel(false)
    navigate('/groups')
    loadGroups()
  }, [setActiveGroup, navigate, loadGroups])

  // アクティブなグループ情報を取得
  const activeGroup = groups.find((g) => g.groupId === activeGroupId)

  if (!activeGroupId) {
    return (
      <GroupList
        groups={groups}
        onSelectGroup={handleSelectGroup}
        onRefresh={loadGroups}
        isLoading={isLoadingGroups}
        error={error}
        unreadCounts={unreadCounts}
        wsStatus={wsStatus}
        nickname={nickname}
      />
    )
  }

  return (
    <div className="flex flex-1 min-h-0">
      {showInfoPanel && (
        <div className="hidden md:block flex-[1] border-r border-gray-200 dark:border-gray-700 min-w-0">
          <GroupInfoPanel
            groupId={activeGroupId}
            onClose={() => setShowInfoPanel(false)}
            onLeave={handleBack}
          />
        </div>
      )}
      <div className="flex-[2] flex flex-col min-h-0 min-w-0">
        <GroupChat
          groupId={activeGroupId}
          groupName={activeGroup?.groupName ?? ''}
          onBack={handleBack}
          onOpenInfo={() => setShowInfoPanel(!showInfoPanel)}
        />
      </div>
    </div>
  )
}
