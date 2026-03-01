import { useEffect, useCallback, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useAppStore } from '@/stores'
import { useGroupChatStore } from '@/stores/groupChatStore'
import { groupService } from '@/services/groupService'
import { friendService } from '@/services/friendService'
import { useWebSocket } from '@/hooks/useWebSocket'
import { FriendList } from './FriendList'
import { GroupList } from './GroupList'
import { GroupChat } from './GroupChat'

/** バックグラウンドポーリング間隔（ミリ秒） */
const BACKGROUND_POLL_INTERVAL = 30000

/**
 * グループチャット画面
 *
 * アクティブなグループが無い場合はフレンド一覧（左）+ グループ一覧（右）を表示し、
 * グループ選択後はチャット画面を表示する。
 */
export function GroupChatScreen() {
  const { groupId: paramGroupId } = useParams<{ groupId?: string }>()
  const navigate = useNavigate()
  const bgPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevUpdatedAtRef = useRef<Record<string, number>>({})

  // ニックネーム
  const nickname = useAppStore((s) => s.config.profile.nickname)

  // WebSocket 接続（グループ一覧レベル — conversation_updated イベント受信用）
  useWebSocket(null)
  const wsStatus = useGroupChatStore((s) => s.wsStatus)

  const activeGroupId = useGroupChatStore((s) => s.activeGroupId)
  const groups = useGroupChatStore((s) => s.groups)
  const friends = useGroupChatStore((s) => s.friends)
  const isLoadingGroups = useGroupChatStore((s) => s.isLoadingGroups)
  const error = useGroupChatStore((s) => s.error)
  const unreadCounts = useGroupChatStore((s) => s.unreadCounts)
  const setGroups = useGroupChatStore((s) => s.setGroups)
  const setFriends = useGroupChatStore((s) => s.setFriends)
  const setActiveGroup = useGroupChatStore((s) => s.setActiveGroup)
  const setLoadingGroups = useGroupChatStore((s) => s.setLoadingGroups)
  const setError = useGroupChatStore((s) => s.setError)
  const incrementUnread = useGroupChatStore((s) => s.incrementUnread)
  const clearUnread = useGroupChatStore((s) => s.clearUnread)

  const [isLoadingFriends, setIsLoadingFriends] = useState(false)

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

  /** フレンド一覧を取得 */
  const loadFriends = useCallback(async () => {
    setIsLoadingFriends(true)
    try {
      const result = await friendService.listFriends()
      setFriends(result)
    } catch (err) {
      console.error('[GroupChatScreen] フレンド一覧の取得に失敗:', err)
    } finally {
      setIsLoadingFriends(false)
    }
  }, [setFriends])

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

  // マウント時にグループ + フレンド一覧を取得
  useEffect(() => {
    loadGroups().then(() => {
      const gs = useGroupChatStore.getState().groups
      const map: Record<string, number> = {}
      for (const g of gs) {
        map[g.groupId] = g.updatedAt
      }
      prevUpdatedAtRef.current = map
    })
    loadFriends()
  }, [loadGroups, loadFriends])

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
    navigate(`/groups/${groupId}`)
  }, [setActiveGroup, clearUnread, navigate])

  /** 一覧に戻る */
  const handleBack = useCallback(() => {
    setActiveGroup(null)
    navigate('/groups')
    loadGroups()
    loadFriends()
  }, [setActiveGroup, navigate, loadGroups, loadFriends])

  // アクティブなグループ情報を取得
  const activeGroup = groups.find((g) => g.groupId === activeGroupId)

  // 一覧表示（フレンド左 + グループ右）
  if (!activeGroupId) {
    return (
      <div className="flex flex-col flex-1 bg-white dark:bg-gray-900" data-testid="multichat-screen">
        {/* 共通ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              マルチチャット
            </h2>
            {wsStatus && (
              <span
                data-testid="ws-status-indicator"
                className={`inline-block w-2.5 h-2.5 rounded-full ${
                  wsStatus === 'open'
                    ? 'bg-green-500 animate-pulse'
                    : wsStatus === 'connecting'
                      ? 'bg-yellow-500'
                      : wsStatus === 'failed'
                        ? 'bg-red-500'
                        : 'bg-gray-400'
                }`}
                title={
                  wsStatus === 'open'
                    ? '接続中'
                    : wsStatus === 'connecting'
                      ? '接続中...'
                      : wsStatus === 'failed'
                        ? '接続エラー'
                        : '未接続'
                }
              />
            )}
            {wsStatus === 'failed' && (
              <span className="text-xs text-red-500">接続エラー</span>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400" data-testid="group-chat-nickname">
            {nickname || 'ゲスト'}
          </p>
        </div>

        {/* 左右分割: フレンド | グループ */}
        <div className="flex flex-1 min-h-0">
          {/* フレンド一覧（左） */}
          <div className="w-1/3 min-w-[200px] max-w-[320px] border-r border-gray-200 dark:border-gray-700 flex flex-col min-h-0">
            <FriendList
              friends={friends}
              onRefresh={loadFriends}
              isLoading={isLoadingFriends}
            />
          </div>

          {/* グループ一覧（右） */}
          <div className="flex-1 flex flex-col min-h-0">
            <GroupList
              groups={groups}
              onSelectGroup={handleSelectGroup}
              onRefresh={loadGroups}
              isLoading={isLoadingGroups}
              error={error}
              unreadCounts={unreadCounts}
            />
          </div>
        </div>
      </div>
    )
  }

  // チャット表示（左: グループ一覧サイドバー、右: チャット）
  return (
    <div className="flex flex-1 min-h-0">
      {/* 左: グループ一覧（デスクトップのみ） */}
      <div className="hidden md:flex w-72 border-r border-gray-200 dark:border-gray-700 flex-col min-h-0">
        <GroupList
          groups={groups}
          onSelectGroup={handleSelectGroup}
          onRefresh={loadGroups}
          unreadCounts={unreadCounts}
          activeGroupId={activeGroupId}
        />
      </div>
      {/* 右: チャット */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        <GroupChat
          groupId={activeGroupId}
          groupName={activeGroup?.groupName ?? ''}
          onBack={handleBack}
          onLeave={handleBack}
        />
      </div>
    </div>
  )
}
