import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Message, AppConfig, AppError } from '@/types'
import { DEFAULT_UI_CONFIG, DEFAULT_USER_PROFILE } from '@/types'
import { MAX_MESSAGE_HISTORY } from '@/utils/performance'

/**
 * グローバルアプリケーション状態
 */
export interface AppState {
  // メッセージ関連
  messages: Message[]
  isLoading: boolean

  // Live2D関連
  currentMotion: string | null
  currentExpression: string | null
  isMotionPlaying: boolean
  motionQueue: string[]

  // 設定関連
  config: AppConfig

  // エラー関連
  lastError: AppError | null

  // アクション
  addMessage: (message: Message) => void
  setLoading: (isLoading: boolean) => void
  setCurrentMotion: (motion: string | null) => void
  setCurrentExpression: (expression: string | null) => void
  setMotionPlaying: (isPlaying: boolean) => void
  enqueueMotion: (motion: string) => void
  dequeueMotion: () => string | null
  updateConfig: (config: Partial<AppConfig>) => void
  setError: (error: AppError | null) => void
  clearMessages: () => void
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
      messages: [],
      isLoading: false,
      currentMotion: null,
      currentExpression: null,
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

      clearMessages: () => set({ messages: [] }),

      // ローディング状態
      setLoading: (isLoading: boolean) => set({ isLoading }),

      // モーションアクション
      setCurrentMotion: (motion: string | null) => set({ currentMotion: motion }),

      setCurrentExpression: (expression: string | null) => set({ currentExpression: expression }),

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
      }),
    }
  )
)
