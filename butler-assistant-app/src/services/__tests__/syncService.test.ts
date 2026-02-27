import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SyncServiceImpl } from '../syncService'
import { useAppStore } from '@/stores/appStore'
import type { Message, AppConfig } from '@/types'

// fetch モック
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// 環境変数モック
vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')

describe('SyncService', () => {
  let syncService: SyncServiceImpl

  const mockToken = 'mock-access-token'

  const mockMessage: Message = {
    id: 'msg-1',
    role: 'user',
    content: 'テストメッセージ',
    timestamp: 1700000000000,
  }

  const mockAssistantMessage: Message = {
    id: 'msg-2',
    role: 'assistant',
    content: '承知いたしました。',
    timestamp: 1700000001000,
    motion: 'bow',
  }

  beforeEach(() => {
    syncService = new SyncServiceImpl()
    vi.clearAllMocks()

    // ストアをリセット
    useAppStore.setState({
      messages: [],
      config: {
        llm: {
          provider: 'gemini',
          apiKey: 'secret-api-key',
          systemPrompt: '',
          temperature: 0.7,
          maxTokens: 1024,
        },
        model: { currentModelId: '/models/mao_pro_jp/mao_pro.model3.json' },
        ui: { theme: 'light', fontSize: 14, characterSize: 100 },
      },
    })
  })

  afterEach(() => {
    syncService.onLogout()
  })

  describe('mergeMessages', () => {
    it('ローカルとサーバーのメッセージを ID ベースで重複排除する', () => {
      const local: Message[] = [
        { id: '1', role: 'user', content: 'A', timestamp: 100 },
        { id: '2', role: 'assistant', content: 'B', timestamp: 200 },
      ]
      const server: Message[] = [
        { id: '2', role: 'assistant', content: 'B-server', timestamp: 200 },
        { id: '3', role: 'user', content: 'C', timestamp: 300 },
      ]

      const merged = syncService.mergeMessages(local, server)

      expect(merged).toHaveLength(3)
      expect(merged.map((m) => m.id)).toEqual(['1', '2', '3'])
      // ローカルが優先される
      expect(merged[1].content).toBe('B')
    })

    it('timestamp 順にソートする', () => {
      const local: Message[] = [
        { id: '3', role: 'user', content: 'C', timestamp: 300 },
      ]
      const server: Message[] = [
        { id: '1', role: 'user', content: 'A', timestamp: 100 },
        { id: '2', role: 'assistant', content: 'B', timestamp: 200 },
      ]

      const merged = syncService.mergeMessages(local, server)

      expect(merged.map((m) => m.id)).toEqual(['1', '2', '3'])
    })

    it('空配列同士をマージしても空配列を返す', () => {
      const merged = syncService.mergeMessages([], [])
      expect(merged).toEqual([])
    })

    it('ローカルのみの場合はそのまま返す', () => {
      const local: Message[] = [mockMessage]
      const merged = syncService.mergeMessages(local, [])
      expect(merged).toEqual(local)
    })

    it('サーバーのみの場合はそのまま返す', () => {
      const server: Message[] = [mockMessage]
      const merged = syncService.mergeMessages([], server)
      expect(merged).toEqual(server)
    })
  })

  describe('onLogin', () => {
    it('サーバーから設定とメッセージを取得してストアにマージする', async () => {
      const serverSettings = {
        llm: { provider: 'claude', apiKey: '', systemPrompt: 'カスタム', temperature: 0.5, maxTokens: 2048 },
        ui: { theme: 'dark', fontSize: 16, characterSize: 100 },
      }

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ settings: serverSettings }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ messages: [mockMessage] }),
        })

      await syncService.onLogin(mockToken)

      const state = useAppStore.getState()
      // 設定がマージされる（API キーはローカルのまま）
      expect(state.config.llm.provider).toBe('claude')
      expect(state.config.ui.theme).toBe('dark')
      // メッセージがマージされる
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0].id).toBe('msg-1')
    })

    it('Authorization ヘッダーにトークンを含める', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ settings: null, messages: [] }),
      })

      await syncService.onLogin(mockToken)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockToken}`,
          }),
        })
      )
    })

    it('サーバーエラーが発生してもクラッシュしない', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      await expect(syncService.onLogin(mockToken)).resolves.toBeUndefined()
    })

    it('設定が null の場合はストアを変更しない', async () => {
      const originalConfig = { ...useAppStore.getState().config }

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ settings: null }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ messages: [] }),
        })

      await syncService.onLogin(mockToken)

      expect(useAppStore.getState().config.llm.provider).toBe(originalConfig.llm.provider)
    })
  })

  describe('saveMessage', () => {
    it('ログイン済みの場合にメッセージを送信する', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ settings: null, messages: [] }),
      })

      await syncService.onLogin(mockToken)
      vi.clearAllMocks()

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      syncService.saveMessage(mockMessage)

      // fire-and-forget なので Promise が解決するのを待つ
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/messages'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(mockMessage),
        })
      )
    })

    it('未ログインの場合は何もしない', () => {
      syncService.saveMessage(mockMessage)
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('saveSettings', () => {
    it('API キーを除外して設定を送信する', async () => {
      vi.useFakeTimers()

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ settings: null, messages: [] }),
      })

      await syncService.onLogin(mockToken)
      vi.clearAllMocks()

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      const config: AppConfig = {
        llm: {
          provider: 'gemini',
          apiKey: 'secret-key-should-not-be-sent',
          systemPrompt: '',
          temperature: 0.7,
          maxTokens: 1024,
        },
        model: { currentModelId: '/models/test.json' },
        ui: { theme: 'dark', fontSize: 16, characterSize: 100 },
      }

      syncService.saveSettings(config)

      // デバウンス（2秒）を進める
      await vi.advanceTimersByTimeAsync(2100)

      vi.useRealTimers()

      expect(mockFetch).toHaveBeenCalled()
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.llm.apiKey).toBe('')
    })

    it('未ログインの場合は何もしない', () => {
      vi.useFakeTimers()

      const config = useAppStore.getState().config
      syncService.saveSettings(config)

      vi.advanceTimersByTime(3000)
      vi.useRealTimers()

      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('onLogout', () => {
    it('ログアウト後はメッセージを送信しない', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ settings: null, messages: [] }),
      })

      await syncService.onLogin(mockToken)
      syncService.onLogout()
      vi.clearAllMocks()

      syncService.saveMessage(mockMessage)
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })
})
