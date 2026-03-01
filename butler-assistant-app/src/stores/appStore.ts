import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import type { Message, AppConfig, AppError } from '@/types'
import { DEFAULT_UI_CONFIG, DEFAULT_USER_PROFILE } from '@/types'
import { MAX_MESSAGE_HISTORY } from '@/utils/performance'

/**
 * グローバルアプリケーション状態
 */
export interface AppState {
  // セッション関連
  sessionId: string

  // メッセージ関連
  messages: Message[]
  isLoading: boolean

  // 過去メッセージ読み込み関連
  messagesCursor: string | null
  hasEarlierMessages: boolean
  isLoadingEarlier: boolean

  // Live2D関連
  currentMotion: string | null
  currentExpression: string | null
  /** 表情変更のたびにインクリメントされるバージョン（useEffect 強制発火用） */
  expressionVersion: number
  isMotionPlaying: boolean
  motionQueue: string[]

  // 設定関連
  config: AppConfig

  // エラー関連
  lastError: AppError | null

  // アクション
  addMessage: (message: Message) => void
  prependMessages: (messages: Message[]) => void
  setLoading: (isLoading: boolean) => void
  setMessagesCursor: (cursor: string | null) => void
  setHasEarlierMessages: (has: boolean) => void
  setLoadingEarlier: (loading: boolean) => void
  setCurrentMotion: (motion: string | null) => void
  setCurrentExpression: (expression: string | null) => void
  setMotionPlaying: (isPlaying: boolean) => void
  enqueueMotion: (motion: string) => void
  dequeueMotion: () => string | null
  updateConfig: (config: Partial<AppConfig>) => void
  setError: (error: AppError | null) => void
  clearMessages: () => void
  resetSession: () => void
}

/**
 * デフォルトの設定
 */
const defaultConfig: AppConfig = {
  model: {
    currentModelId: '/models/mao_pro_jp/mao_pro.model3.json',
  },
  ui: DEFAULT_UI_CONFIG,
  profile: DEFAULT_USER_PROFILE,
}

/**
 * アプリケーションストア
 */
export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // 初期状態
      sessionId: uuidv4(),
      messages: [],
      isLoading: false,
      messagesCursor: null,
      hasEarlierMessages: false,
      isLoadingEarlier: false,
      currentMotion: null,
      currentExpression: null,
      expressionVersion: 0,
      isMotionPlaying: false,
      motionQueue: [],
      config: defaultConfig,
      lastError: null,

      // メッセージアクション（履歴制限付き）
      addMessage: (message: Message) =>
        set((state) => {
          const newMessages = [...state.messages, message]
          // 履歴制限を超えた場合、古いメッセージを削除
          if (newMessages.length > MAX_MESSAGE_HISTORY) {
            return { messages: newMessages.slice(-MAX_MESSAGE_HISTORY) }
          }
          return { messages: newMessages }
        }),

      clearMessages: () => set({ messages: [], messagesCursor: null, hasEarlierMessages: false, sessionId: uuidv4() }),

      resetSession: () => set({ sessionId: uuidv4() }),

      // 過去メッセージを先頭に追加（重複排除）
      prependMessages: (newMessages: Message[]) =>
        set((state) => {
          const existingIds = new Set(state.messages.map((m) => m.id))
          const unique = newMessages.filter((m) => !existingIds.has(m.id))
          return { messages: [...unique, ...state.messages] }
        }),

      // ローディング状態
      setLoading: (isLoading: boolean) => set({ isLoading }),

      // 過去メッセージ読み込み状態
      setMessagesCursor: (cursor: string | null) => set({ messagesCursor: cursor }),
      setHasEarlierMessages: (has: boolean) => set({ hasEarlierMessages: has }),
      setLoadingEarlier: (loading: boolean) => set({ isLoadingEarlier: loading }),

      // モーションアクション
      setCurrentMotion: (motion: string | null) => set({ currentMotion: motion }),

      setCurrentExpression: (expression: string | null) =>
        set((state) => ({ currentExpression: expression, expressionVersion: state.expressionVersion + 1 })),

      setMotionPlaying: (isPlaying: boolean) => set({ isMotionPlaying: isPlaying }),

      enqueueMotion: (motion: string) =>
        set((state) => ({
          motionQueue: [...state.motionQueue, motion],
        })),

      dequeueMotion: () => {
        const state = get()
        if (state.motionQueue.length === 0) {
          return null
        }
        const [first, ...rest] = state.motionQueue
        set({ motionQueue: rest })
        return first
      },

      // 設定アクション
      updateConfig: (configUpdate: Partial<AppConfig>) =>
        set((state) => ({
          config: {
            ...state.config,
            ...configUpdate,
            model: {
              ...state.config.model,
              ...(configUpdate.model || {}),
            },
            ui: {
              ...state.config.ui,
              ...(configUpdate.ui || {}),
            },
            profile: {
              ...state.config.profile,
              ...(configUpdate.profile || {}),
            },
          },
        })),

      // エラーアクション
      setError: (error: AppError | null) => set({ lastError: error }),
    }),
    {
      name: 'butler-app-storage',
      partialize: (state) => ({
        messages: state.messages,
        config: state.config,
        // messagesCursor, hasEarlierMessages, isLoadingEarlier は永続化不要（毎回サーバーから取得）
      }),
    }
  )
)
