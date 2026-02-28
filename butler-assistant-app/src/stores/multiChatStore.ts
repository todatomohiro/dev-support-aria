import { create } from 'zustand'
import type { FriendLink, ConversationSummary, ConversationMessage, WsStatus } from '@/types'

/**
 * マルチチャットの状態管理インターフェース
 */
export interface MultiChatState {
  // 状態
  friends: FriendLink[]
  myFriendCode: string | null
  conversations: ConversationSummary[]
  activeConversationId: string | null
  activeMessages: ConversationMessage[]
  lastPollTimestamp: number | null
  isSending: boolean
  error: string | null
  isLoadingConversations: boolean
  isLoadingMessages: boolean
  unreadCounts: Record<string, number>
  wsStatus: WsStatus

  // アクション
  /** フレンド一覧を設定 */
  setFriends: (friends: FriendLink[]) => void
  /** 自分のフレンドコードを設定 */
  setMyFriendCode: (code: string | null) => void
  /** 会話一覧を設定 */
  setConversations: (conversations: ConversationSummary[]) => void
  /** アクティブな会話を設定 */
  setActiveConversation: (id: string | null) => void
  /** アクティブな会話のメッセージを設定 */
  setActiveMessages: (messages: ConversationMessage[]) => void
  /** メッセージを追加 */
  appendMessages: (messages: ConversationMessage[]) => void
  /** 最終ポーリングタイムスタンプを設定 */
  setLastPollTimestamp: (ts: number | null) => void
  /** 送信中フラグを設定 */
  setSending: (sending: boolean) => void
  /** エラーを設定 */
  setError: (error: string | null) => void
  /** 会話一覧のローディング状態を設定 */
  setLoadingConversations: (loading: boolean) => void
  /** メッセージのローディング状態を設定 */
  setLoadingMessages: (loading: boolean) => void
  /** 未読カウントを加算 */
  incrementUnread: (conversationId: string, count?: number) => void
  /** 未読カウントをクリア */
  clearUnread: (conversationId: string) => void
  /** WebSocket 接続ステータスを設定 */
  setWsStatus: (status: WsStatus) => void
  /** 会話サマリーを更新（WebSocket 経由） */
  updateConversationSummary: (conversationId: string, lastMessage: string, updatedAt: number) => void
  /** 状態をリセット */
  reset: () => void
}

/** 初期状態 */
const initialState = {
  friends: [] as FriendLink[],
  myFriendCode: null as string | null,
  conversations: [] as ConversationSummary[],
  activeConversationId: null as string | null,
  activeMessages: [] as ConversationMessage[],
  lastPollTimestamp: null as number | null,
  isSending: false,
  error: null as string | null,
  isLoadingConversations: false,
  isLoadingMessages: false,
  unreadCounts: {} as Record<string, number>,
  wsStatus: 'disconnected' as WsStatus,
}

/**
 * マルチチャットストア（永続化なし — サーバーが信頼元）
 */
export const useMultiChatStore = create<MultiChatState>()((set) => ({
  ...initialState,

  setFriends: (friends: FriendLink[]) => set({ friends }),

  setMyFriendCode: (code: string | null) => set({ myFriendCode: code }),

  setConversations: (conversations: ConversationSummary[]) => set({ conversations }),

  setActiveConversation: (id: string | null) => set({ activeConversationId: id }),

  setActiveMessages: (messages: ConversationMessage[]) => set({ activeMessages: messages }),

  appendMessages: (messages: ConversationMessage[]) =>
    set((state) => {
      // 重複排除（id ベース）
      const existingIds = new Set(state.activeMessages.map((m) => m.id))
      const newMessages = messages.filter((m) => !existingIds.has(m.id))
      if (newMessages.length === 0) return state
      return { activeMessages: [...state.activeMessages, ...newMessages] }
    }),

  setLastPollTimestamp: (ts: number | null) => set({ lastPollTimestamp: ts }),

  setSending: (sending: boolean) => set({ isSending: sending }),

  setError: (error: string | null) => set({ error }),

  setLoadingConversations: (loading: boolean) => set({ isLoadingConversations: loading }),

  setLoadingMessages: (loading: boolean) => set({ isLoadingMessages: loading }),

  incrementUnread: (conversationId: string, count: number = 1) =>
    set((state) => ({
      unreadCounts: {
        ...state.unreadCounts,
        [conversationId]: (state.unreadCounts[conversationId] ?? 0) + count,
      },
    })),

  clearUnread: (conversationId: string) =>
    set((state) => {
      if (!state.unreadCounts[conversationId]) return state
      const { [conversationId]: _, ...rest } = state.unreadCounts
      return { unreadCounts: rest }
    }),

  setWsStatus: (status: WsStatus) => set({ wsStatus: status }),

  updateConversationSummary: (conversationId: string, lastMessage: string, updatedAt: number) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.conversationId === conversationId
          ? { ...c, lastMessage, updatedAt }
          : c
      ),
    })),

  reset: () => set(initialState),
}))
