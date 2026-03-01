import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SyncServiceImpl } from '../syncService'
import { useAppStore } from '@/stores/appStore'
import type { Message, AppConfig } from '@/types'

// fetch モック
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// BroadcastChannel モック
let mockChannelInstance: {
  postMessage: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  onmessage: ((event: MessageEvent) => void) | null
} | null = null

vi.stubGlobal(
  'BroadcastChannel',
  class MockBroadcastChannel {
    postMessage = vi.fn()
    close = vi.fn()
    onmessage: ((event: MessageEvent) => void) | null = null

    constructor() {
      mockChannelInstance = this
    }
  }
)

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
    mockChannelInstance = null

    // ストアをリセット
    useAppStore.setState({
      messages: [],
      config: {
        model: { currentModelId: '/models/mao_pro_jp/mao_pro.model3.json' },
        ui: { theme: 'light', fontSize: 14, characterSize: 100 },
      },
    })
  })

  afterEach(() => {
    syncService.onLogout()
    vi.useRealTimers()
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
        ui: { theme: 'dark', fontSize: 16, characterSize: 100 },
      }

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ settings: serverSettings }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ messages: [mockMessage], nextCursor: 'MSG#2024-01-01' }),
        })

      await syncService.onLogin(mockToken)

      const state = useAppStore.getState()
      // 設定がマージされる
      expect(state.config.ui.theme).toBe('dark')
      // メッセージがマージされる
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0].id).toBe('msg-1')
      // カーソルが保存される
      expect(state.messagesCursor).toBe('MSG#2024-01-01')
      expect(state.hasEarlierMessages).toBe(true)
    })

    it('nextCursor がない場合は hasEarlierMessages が false になる', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ settings: null }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ messages: [mockMessage] }),
        })

      await syncService.onLogin(mockToken)

      const state = useAppStore.getState()
      expect(state.messagesCursor).toBeNull()
      expect(state.hasEarlierMessages).toBe(false)
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

      expect(useAppStore.getState().config.ui.theme).toBe(originalConfig.ui.theme)
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
    it('設定をサーバーに送信する', async () => {
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
        model: { currentModelId: '/models/test.json' },
        ui: { theme: 'dark', fontSize: 16, characterSize: 100 },
      }

      syncService.saveSettings(config)

      // デバウンス（2秒）を進める
      await vi.advanceTimersByTimeAsync(2100)

      vi.useRealTimers()

      expect(mockFetch).toHaveBeenCalled()
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.ui.theme).toBe('dark')
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

  describe('BroadcastChannel', () => {
    /** onLogin のデフォルトモック */
    function mockLoginFetch() {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ settings: null, messages: [] }),
      })
    }

    it('saveMessage 時に BroadcastChannel へ postMessage される', async () => {
      mockLoginFetch()
      await syncService.onLogin(mockToken)

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      syncService.saveMessage(mockMessage)

      expect(mockChannelInstance!.postMessage).toHaveBeenCalledWith(mockMessage)
    })

    it('他タブからのメッセージがストアに追加される', async () => {
      mockLoginFetch()
      await syncService.onLogin(mockToken)

      expect(mockChannelInstance).not.toBeNull()
      expect(mockChannelInstance!.onmessage).not.toBeNull()

      // 他タブからメッセージ受信をシミュレート
      mockChannelInstance!.onmessage!({ data: mockAssistantMessage } as MessageEvent)

      const state = useAppStore.getState()
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0].id).toBe('msg-2')
    })

    it('重複メッセージ（同一 ID）は追加されない', async () => {
      mockLoginFetch()
      await syncService.onLogin(mockToken)

      // 先にストアにメッセージを追加
      useAppStore.getState().addMessage(mockMessage)

      // 同じ ID のメッセージを受信
      mockChannelInstance!.onmessage!({ data: mockMessage } as MessageEvent)

      const state = useAppStore.getState()
      expect(state.messages).toHaveLength(1)
    })

    it('onLogout 時にチャンネルが close される', async () => {
      mockLoginFetch()
      await syncService.onLogin(mockToken)

      syncService.onLogout()

      expect(mockChannelInstance!.close).toHaveBeenCalled()
    })
  })

  describe('ポーリング', () => {
    /** onLogin のデフォルトモック */
    function mockLoginFetch() {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ settings: null, messages: [] }),
      })
    }

    it('onLogin 後にポーリングが開始される', async () => {
      vi.useFakeTimers()

      mockLoginFetch()
      await syncService.onLogin(mockToken)
      vi.clearAllMocks()

      // ポーリング用のレスポンスをセットアップ
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [mockMessage] }),
      })

      // 30秒進める
      await vi.advanceTimersByTimeAsync(SyncServiceImpl.POLLING_INTERVAL)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/messages?limit=100'),
        expect.any(Object)
      )
    })

    it('30秒後にサーバーからメッセージを取得する', async () => {
      vi.useFakeTimers()

      mockLoginFetch()
      await syncService.onLogin(mockToken)
      vi.clearAllMocks()

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [mockMessage] }),
      })

      await vi.advanceTimersByTimeAsync(SyncServiceImpl.POLLING_INTERVAL)

      const state = useAppStore.getState()
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0].id).toBe('msg-1')
    })

    it('新しいメッセージがあればストアに反映される', async () => {
      vi.useFakeTimers()

      mockLoginFetch()
      await syncService.onLogin(mockToken)

      // 既にストアにメッセージがある状態
      useAppStore.getState().addMessage(mockMessage)
      vi.clearAllMocks()

      // サーバーに追加メッセージがある
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ messages: [mockMessage, mockAssistantMessage] }),
      })

      await vi.advanceTimersByTimeAsync(SyncServiceImpl.POLLING_INTERVAL)

      const state = useAppStore.getState()
      expect(state.messages).toHaveLength(2)
    })

    it('件数に差分がなければ setState を呼ばない', async () => {
      vi.useFakeTimers()

      mockLoginFetch()
      await syncService.onLogin(mockToken)

      // 既にストアにメッセージがある
      useAppStore.getState().addMessage(mockMessage)
      vi.clearAllMocks()

      const setStateSpy = vi.spyOn(useAppStore, 'setState')

      // サーバーにも同じメッセージのみ
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [mockMessage] }),
      })

      await vi.advanceTimersByTimeAsync(SyncServiceImpl.POLLING_INTERVAL)

      expect(setStateSpy).not.toHaveBeenCalled()
      setStateSpy.mockRestore()
    })

    it('onLogout 時にポーリングが停止される', async () => {
      vi.useFakeTimers()

      mockLoginFetch()
      await syncService.onLogin(mockToken)
      syncService.onLogout()
      vi.clearAllMocks()

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [mockMessage] }),
      })

      await vi.advanceTimersByTimeAsync(SyncServiceImpl.POLLING_INTERVAL)

      // ポーリングが停止しているので fetch は呼ばれない
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('バックグラウンド時にポーリングが停止される', async () => {
      vi.useFakeTimers()

      mockLoginFetch()
      await syncService.onLogin(mockToken)
      vi.clearAllMocks()

      // バックグラウンドへ遷移
      Object.defineProperty(document, 'hidden', {
        value: true,
        writable: true,
        configurable: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [mockMessage] }),
      })

      // 30秒進めてもフェッチされない
      await vi.advanceTimersByTimeAsync(SyncServiceImpl.POLLING_INTERVAL)

      expect(mockFetch).not.toHaveBeenCalled()

      // フォアグラウンド復帰
      Object.defineProperty(document, 'hidden', {
        value: false,
        writable: true,
        configurable: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))

      // 復帰時に即座にフェッチされる
      await vi.advanceTimersByTimeAsync(0)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/messages?limit=100'),
        expect.any(Object)
      )
    })

    it('iOS: hidden を経由せずフォアグラウンド復帰してもポーリングが再開される', async () => {
      vi.useFakeTimers()

      mockLoginFetch()
      await syncService.onLogin(mockToken)
      vi.clearAllMocks()

      // iOS ではバックグラウンド中に JS が凍結され、hidden ハンドラーが呼ばれない。
      // フォアグラウンド復帰時に直接 visible イベントが発火するケースをシミュレート。
      Object.defineProperty(document, 'hidden', {
        value: false,
        writable: true,
        configurable: true,
      })

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [mockMessage] }),
      })

      // hidden を経由せず直接 visible で復帰
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)

      // 復帰時に即座にフェッチされる
      expect(mockFetch).toHaveBeenCalledTimes(1)
      vi.clearAllMocks()

      // さらに30秒後にもポーリングが動くことを確認
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [mockMessage] }),
      })

      await vi.advanceTimersByTimeAsync(SyncServiceImpl.POLLING_INTERVAL)

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('ポーリングエラー時にクラッシュしない', async () => {
      vi.useFakeTimers()

      mockLoginFetch()
      await syncService.onLogin(mockToken)
      vi.clearAllMocks()

      mockFetch.mockRejectedValue(new Error('Network error'))

      // エラーが発生してもクラッシュしない
      await vi.advanceTimersByTimeAsync(SyncServiceImpl.POLLING_INTERVAL)

      // ストアは変更されない
      expect(useAppStore.getState().messages).toHaveLength(0)
    })
  })

  describe('fetchEarlierMessages', () => {
    it('before カーソルを使って過去メッセージを取得する', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ settings: null, messages: [] }),
      })
      await syncService.onLogin(mockToken)
      vi.clearAllMocks()

      const earlierMessages: Message[] = [
        { id: 'old-1', role: 'user', content: '過去のメッセージ', timestamp: 1600000000000 },
      ]

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ messages: earlierMessages, nextCursor: 'MSG#2023-12-01' }),
      })

      const result = await syncService.fetchEarlierMessages('MSG#2024-01-01')

      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].id).toBe('old-1')
      expect(result.nextCursor).toBe('MSG#2023-12-01')

      // before パラメータが URL に含まれる
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/messages?limit=50&before=MSG%232024-01-01'),
        expect.any(Object)
      )
    })

    it('nextCursor がない場合は null を返す', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ settings: null, messages: [] }),
      })
      await syncService.onLogin(mockToken)
      vi.clearAllMocks()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ messages: [] }),
      })

      const result = await syncService.fetchEarlierMessages('MSG#2024-01-01')

      expect(result.messages).toHaveLength(0)
      expect(result.nextCursor).toBeNull()
    })

    it('カスタム limit を指定できる', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ settings: null, messages: [] }),
      })
      await syncService.onLogin(mockToken)
      vi.clearAllMocks()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ messages: [] }),
      })

      await syncService.fetchEarlierMessages('MSG#2024-01-01', 20)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/messages?limit=20&before='),
        expect.any(Object)
      )
    })
  })
})
