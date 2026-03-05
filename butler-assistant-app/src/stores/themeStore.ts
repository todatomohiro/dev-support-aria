import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { ThemeSession, Message, ModelKey } from '@/types'
import type { WorkConnection } from '@/types/work'

/**
 * テーマストアの状態管理インターフェース
 */
export interface ThemeState {
  // 状態
  themes: ThemeSession[]
  activeThemeId: string | null
  activeMessages: Message[]
  isLoading: boolean
  isSending: boolean
  error: string | null
  sessionId: string
  activeWorkConnection: WorkConnection | null

  // アクション
  /** テーマ一覧を設定 */
  setThemes: (themes: ThemeSession[]) => void
  /** アクティブなテーマを設定 */
  setActiveTheme: (id: string | null) => void
  /** アクティブなテーマのメッセージを設定 */
  setActiveMessages: (messages: Message[]) => void
  /** メッセージを追加 */
  addMessage: (message: Message) => void
  /** ローディング状態を設定 */
  setLoading: (loading: boolean) => void
  /** 送信中フラグを設定 */
  setSending: (sending: boolean) => void
  /** エラーを設定 */
  setError: (error: string | null) => void
  /** テーマセッションをリセット（新しい sessionId 生成） */
  resetSession: () => void
  /** テーマ名を更新（トピック自動命名） */
  updateThemeName: (themeId: string, themeName: string) => void
  /** テーマのモデルキーを更新 */
  updateThemeModelKey: (themeId: string, modelKey: ModelKey) => void
  /** テーマのカテゴリとモデルキーを更新 */
  updateThemeCategory: (themeId: string, category: string, modelKey: ModelKey, subcategory?: string) => void
  /** ワーク接続を設定 */
  setWorkConnection: (conn: WorkConnection | null) => void
  /** ワーク接続をクリア */
  clearWorkConnection: () => void
  /** テーマを楽観的に削除 */
  removeTheme: (themeId: string) => void
  /** 状態を完全リセット */
  reset: () => void
}

/** 初期状態 */
const initialState = {
  themes: [] as ThemeSession[],
  activeThemeId: null as string | null,
  activeMessages: [] as Message[],
  isLoading: false,
  isSending: false,
  error: null as string | null,
  sessionId: uuidv4(),
  activeWorkConnection: null as WorkConnection | null,
}

/**
 * テーマストア（永続化なし — サーバーが信頼元）
 */
export const useThemeStore = create<ThemeState>()((set) => ({
  ...initialState,

  setThemes: (themes: ThemeSession[]) => set({ themes }),

  setActiveTheme: (id: string | null) => set({
    activeThemeId: id,
    activeMessages: [],
    sessionId: uuidv4(),
  }),

  setActiveMessages: (messages: Message[]) => set({ activeMessages: messages }),

  addMessage: (message: Message) =>
    set((state) => ({
      activeMessages: [...state.activeMessages, message],
    })),

  setLoading: (loading: boolean) => set({ isLoading: loading }),

  setSending: (sending: boolean) => set({ isSending: sending }),

  setError: (error: string | null) => set({ error }),

  updateThemeName: (themeId: string, themeName: string) =>
    set((state) => ({
      themes: state.themes.map((t) =>
        t.themeId === themeId ? { ...t, themeName } : t
      ),
    })),

  updateThemeModelKey: (themeId: string, modelKey: ModelKey) =>
    set((state) => ({
      themes: state.themes.map((t) =>
        t.themeId === themeId ? { ...t, modelKey } : t
      ),
    })),

  updateThemeCategory: (themeId: string, category: string, modelKey: ModelKey, subcategory?: string) =>
    set((state) => ({
      themes: state.themes.map((t) =>
        t.themeId === themeId ? { ...t, category, modelKey, subcategory } : t
      ),
    })),

  setWorkConnection: (conn: WorkConnection | null) => set({ activeWorkConnection: conn }),

  clearWorkConnection: () => set({ activeWorkConnection: null }),

  removeTheme: (themeId: string) =>
    set((state) => ({
      themes: state.themes.filter((t) => t.themeId !== themeId),
    })),

  resetSession: () => set({
    activeMessages: [],
    sessionId: uuidv4(),
  }),

  reset: () => set({ ...initialState, sessionId: uuidv4() }),
}))
