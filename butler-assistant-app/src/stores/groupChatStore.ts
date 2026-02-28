import { create } from 'zustand'
import type { FriendLink, GroupSummary, GroupMessage, GroupMember, WsStatus } from '@/types'

/**
 * グループチャットの状態管理インターフェース
 */
export interface GroupChatState {
  // 状態
  friends: FriendLink[]
  myUserCode: string | null
  groups: GroupSummary[]
  activeGroupId: string | null
  activeMessages: GroupMessage[]
  activeMembers: GroupMember[]
  lastPollTimestamp: number | null
  isSending: boolean
  error: string | null
  isLoadingGroups: boolean
  isLoadingMessages: boolean
  unreadCounts: Record<string, number>
  wsStatus: WsStatus

  // アクション
  /** フレンド一覧を設定 */
  setFriends: (friends: FriendLink[]) => void
  /** 自分のユーザーコードを設定 */
  setMyUserCode: (code: string | null) => void
  /** グループ一覧を設定 */
  setGroups: (groups: GroupSummary[]) => void
  /** アクティブなグループを設定 */
  setActiveGroup: (id: string | null) => void
  /** アクティブなグループのメッセージを設定 */
  setActiveMessages: (messages: GroupMessage[]) => void
  /** メッセージを追加 */
  appendMessages: (messages: GroupMessage[]) => void
  /** アクティブなグループのメンバーを設定 */
  setActiveMembers: (members: GroupMember[]) => void
  /** 最終ポーリングタイムスタンプを設定 */
  setLastPollTimestamp: (ts: number | null) => void
  /** 送信中フラグを設定 */
  setSending: (sending: boolean) => void
  /** エラーを設定 */
  setError: (error: string | null) => void
  /** グループ一覧のローディング状態を設定 */
  setLoadingGroups: (loading: boolean) => void
  /** メッセージのローディング状態を設定 */
  setLoadingMessages: (loading: boolean) => void
  /** 未読カウントを加算 */
  incrementUnread: (groupId: string, count?: number) => void
  /** 未読カウントをクリア */
  clearUnread: (groupId: string) => void
  /** WebSocket 接続ステータスを設定 */
  setWsStatus: (status: WsStatus) => void
  /** グループサマリーを更新（WebSocket 経由） */
  updateGroupSummary: (groupId: string, lastMessage: string, updatedAt: number) => void
  /** 状態をリセット */
  reset: () => void
}

/** 初期状態 */
const initialState = {
  friends: [] as FriendLink[],
  myUserCode: null as string | null,
  groups: [] as GroupSummary[],
  activeGroupId: null as string | null,
  activeMessages: [] as GroupMessage[],
  activeMembers: [] as GroupMember[],
  lastPollTimestamp: null as number | null,
  isSending: false,
  error: null as string | null,
  isLoadingGroups: false,
  isLoadingMessages: false,
  unreadCounts: {} as Record<string, number>,
  wsStatus: 'disconnected' as WsStatus,
}

/**
 * グループチャットストア（永続化なし — サーバーが信頼元）
 */
export const useGroupChatStore = create<GroupChatState>()((set) => ({
  ...initialState,

  setFriends: (friends: FriendLink[]) => set({ friends }),

  setMyUserCode: (code: string | null) => set({ myUserCode: code }),

  setGroups: (groups: GroupSummary[]) => set({ groups }),

  setActiveGroup: (id: string | null) => set({ activeGroupId: id }),

  setActiveMessages: (messages: GroupMessage[]) => set({ activeMessages: messages }),

  appendMessages: (messages: GroupMessage[]) =>
    set((state) => {
      // 重複排除（id ベース）
      const existingIds = new Set(state.activeMessages.map((m) => m.id))
      const newMessages = messages.filter((m) => !existingIds.has(m.id))
      if (newMessages.length === 0) return state
      return { activeMessages: [...state.activeMessages, ...newMessages] }
    }),

  setActiveMembers: (members: GroupMember[]) => set({ activeMembers: members }),

  setLastPollTimestamp: (ts: number | null) => set({ lastPollTimestamp: ts }),

  setSending: (sending: boolean) => set({ isSending: sending }),

  setError: (error: string | null) => set({ error }),

  setLoadingGroups: (loading: boolean) => set({ isLoadingGroups: loading }),

  setLoadingMessages: (loading: boolean) => set({ isLoadingMessages: loading }),

  incrementUnread: (groupId: string, count: number = 1) =>
    set((state) => ({
      unreadCounts: {
        ...state.unreadCounts,
        [groupId]: (state.unreadCounts[groupId] ?? 0) + count,
      },
    })),

  clearUnread: (groupId: string) =>
    set((state) => {
      if (!state.unreadCounts[groupId]) return state
      const { [groupId]: _, ...rest } = state.unreadCounts
      return { unreadCounts: rest }
    }),

  setWsStatus: (status: WsStatus) => set({ wsStatus: status }),

  updateGroupSummary: (groupId: string, lastMessage: string, updatedAt: number) =>
    set((state) => ({
      groups: state.groups.map((g) =>
        g.groupId === groupId
          ? { ...g, lastMessage, updatedAt }
          : g
      ),
    })),

  reset: () => set(initialState),
}))
