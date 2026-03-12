import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import type { Message, AppConfig, AppError, UserLocation, UsageInfo } from '@/types'
import { DEFAULT_UI_CONFIG, DEFAULT_USER_PROFILE } from '@/types'
import { MAX_MESSAGE_HISTORY } from '@/utils/performance'

/** 画像の保持期間（1日 = 24時間） */
const IMAGE_EXPIRY_MS = 24 * 60 * 60 * 1000

/**
 * メッセージ配列から期限切れの画像を除去する
 *
 * imageBase64 が含まれるメッセージのうち、timestamp が IMAGE_EXPIRY_MS より古いものは
 * imageBase64 を undefined に置き換える。テキストはそのまま保持。
 */
function stripExpiredImages(messages: Message[]): Message[] {
  const cutoff = Date.now() - IMAGE_EXPIRY_MS
  let changed = false
  const result = messages.map((msg) => {
    if (msg.imageBase64 && msg.timestamp < cutoff) {
      changed = true
      const { imageBase64: _, ...rest } = msg
      return rest
    }
    return msg
  })
  return changed ? result : messages
}

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

  // 位置情報関連
  currentLocation: UserLocation | null

  // モデルメタデータ（サーバーから取得した感情・モーションマッピング）
  activeModelMeta: {
    modelId: string
    emotionMapping: Record<string, string>
    motionMapping: Record<string, { group: string; index: number }>
  } | null

  // 設定関連
  config: AppConfig

  // 最終アクティブ時刻（挨拶の不在期間判定用）
  lastActiveTimestamp: number | null

  // ストリーミング関連
  streamingText: string | null
  streamingRequestId: string | null

  // ブリーフィングコンテキスト（直前のブリーフィング発言を次の送信時に引き継ぐ、非永続）
  lastBriefingContext: string | null

  // 使用量（レートリミット）— 非永続、サーバーが信頼元
  usageInfo: UsageInfo | null

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
  setCurrentLocation: (location: UserLocation | null) => void
  setActiveModelMeta: (meta: AppState['activeModelMeta']) => void
  updateConfig: (config: Partial<AppConfig>) => void
  updateLastActive: () => void
  setError: (error: AppError | null) => void
  setStreamingText: (text: string | null) => void
  setStreamingRequestId: (id: string | null) => void
  appendStreamingText: (delta: string) => void
  setLastBriefingContext: (context: string | null) => void
  setUsageInfo: (info: UsageInfo | null) => void
  decrementUsage: () => void
  clearMessages: () => void
  resetSession: () => void
  removeMessageImage: (messageId: string) => void
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
      currentLocation: null,
      activeModelMeta: null,
      lastActiveTimestamp: null,
      config: defaultConfig,
      streamingText: null,
      streamingRequestId: null,
      lastBriefingContext: null,
      usageInfo: null,
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

      // 指定メッセージの画像を削除
      removeMessageImage: (messageId: string) =>
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === messageId && msg.imageBase64
              ? (() => { const { imageBase64: _, ...rest } = msg; return rest })()
              : msg
          ),
        })),

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

      // 位置情報アクション
      setCurrentLocation: (location: UserLocation | null) => set({ currentLocation: location }),
      setActiveModelMeta: (meta) => set({ activeModelMeta: meta }),

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

      // 最終アクティブ時刻を更新
      updateLastActive: () => set({ lastActiveTimestamp: Date.now() }),

      // エラーアクション
      setError: (error: AppError | null) => set({ lastError: error }),
      setStreamingText: (text: string | null) => set({ streamingText: text }),
      setStreamingRequestId: (id: string | null) => set({ streamingRequestId: id }),
      appendStreamingText: (delta: string) => set((state) => ({
        streamingText: (state.streamingText ?? '') + delta,
      })),
      setLastBriefingContext: (context: string | null) => set({ lastBriefingContext: context }),
      setUsageInfo: (info: UsageInfo | null) => set({ usageInfo: info }),
      decrementUsage: () => set((state) => {
        if (!state.usageInfo) return state
        const { daily, monthly } = state.usageInfo
        return {
          usageInfo: {
            ...state.usageInfo,
            daily: daily.limit < 0 ? daily : {
              ...daily,
              used: daily.used + 1,
              remaining: Math.max(0, daily.remaining - 1),
            },
            monthly: monthly.limit < 0 ? monthly : {
              ...monthly,
              used: monthly.used + 1,
              remaining: Math.max(0, monthly.remaining - 1),
            },
          },
        }
      }),
    }),
    {
      name: 'butler-app-storage',
      partialize: (state) => ({
        messages: state.messages,
        config: state.config,
        lastActiveTimestamp: state.lastActiveTimestamp,
        activeModelMeta: state.activeModelMeta,
        // messagesCursor, hasEarlierMessages, isLoadingEarlier は永続化不要（毎回サーバーから取得）
      }),
      // localStorage から復元時に期限切れ画像（1日超）を除去
      onRehydrateStorage: () => (state) => {
        if (state) {
          const cleaned = stripExpiredImages(state.messages)
          if (cleaned !== state.messages) {
            state.messages = cleaned
          }
        }
      },
    }
  )
)
