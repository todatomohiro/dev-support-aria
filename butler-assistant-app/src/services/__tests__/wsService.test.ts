import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useMultiChatStore } from '@/stores/multiChatStore'

// conversationService をモック
const mockPollNewMessages = vi.fn().mockResolvedValue([])
vi.mock('@/services/conversationService', () => ({
  conversationService: {
    pollNewMessages: (...args: unknown[]) => mockPollNewMessages(...args),
  },
}))

// authStore をモック
vi.mock('@/auth/authStore', () => ({
  useAuthStore: Object.assign(
    vi.fn((selector: (state: Record<string, unknown>) => unknown) =>
      selector({ accessToken: 'test-token' })
    ),
    {
      getState: () => ({ accessToken: 'test-token' }),
    }
  ),
}))

// WebSocket モック
class MockWebSocket {
  url: string
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  close = vi.fn()

  constructor(url: string) {
    this.url = url
  }

  /** テスト用: onopen を発火 */
  simulateOpen(): void {
    this.onopen?.({} as Event)
  }

  /** テスト用: onmessage を発火 */
  simulateMessage(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
  }

  /** テスト用: onclose を発火 */
  simulateClose(): void {
    this.onclose?.({} as CloseEvent)
  }
}

let mockWsInstances: MockWebSocket[] = []
const originalWebSocket = globalThis.WebSocket

describe('WsServiceImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    useMultiChatStore.getState().reset()
    mockWsInstances = []

    // WebSocket をモック（コンストラクタとして動作するように class を使用）
    globalThis.WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url)
        mockWsInstances.push(this)
      }
    } as unknown as typeof WebSocket

    // import.meta.env をモック
    vi.stubEnv('VITE_WS_URL', 'wss://test.example.com')
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.WebSocket = originalWebSocket
    vi.unstubAllEnvs()
  })

  /** WsServiceImpl を都度取得（モジュールキャッシュ回避） */
  async function createService() {
    const { WsServiceImpl } = await import('../wsService')
    return new WsServiceImpl()
  }

  describe('connect', () => {
    it('WebSocket 接続を開始しステータスが connecting になる', async () => {
      const service = await createService()
      service.connect('test-token')

      expect(useMultiChatStore.getState().wsStatus).toBe('connecting')
      expect(mockWsInstances).toHaveLength(1)
      expect(mockWsInstances[0].url).toBe('wss://test.example.com?token=test-token')
    })

    it('接続成功でステータスが open になる', async () => {
      const service = await createService()
      service.connect('test-token')

      mockWsInstances[0].simulateOpen()

      expect(useMultiChatStore.getState().wsStatus).toBe('open')
    })

    it('VITE_WS_URL が未設定の場合は何もしない', async () => {
      vi.stubEnv('VITE_WS_URL', '')
      const service = await createService()
      service.connect('test-token')

      expect(mockWsInstances).toHaveLength(0)
    })
  })

  describe('disconnect', () => {
    it('接続を閉じてステータスが disconnected になる', async () => {
      const service = await createService()
      service.connect('test-token')
      mockWsInstances[0].simulateOpen()

      service.disconnect()

      expect(useMultiChatStore.getState().wsStatus).toBe('disconnected')
      expect(mockWsInstances[0].close).toHaveBeenCalled()
    })
  })

  describe('handleMessage', () => {
    it('購読中の会話に new_message が来たら appendMessages する', async () => {
      const service = await createService()
      service.connect('test-token')
      mockWsInstances[0].simulateOpen()
      service.subscribe('conv_1')

      const msg = { id: 'msg-1', senderId: 'user-1', senderName: 'User', content: 'Hello', timestamp: 1700000000000, type: 'text' }
      mockWsInstances[0].simulateMessage({
        type: 'new_message',
        conversationId: 'conv_1',
        message: msg,
      })

      expect(useMultiChatStore.getState().activeMessages).toEqual([msg])
      expect(useMultiChatStore.getState().lastPollTimestamp).toBe(1700000000000)
    })

    it('未購読の会話に new_message が来たら incrementUnread する', async () => {
      const service = await createService()
      service.connect('test-token')
      mockWsInstances[0].simulateOpen()

      mockWsInstances[0].simulateMessage({
        type: 'new_message',
        conversationId: 'conv_2',
        message: { id: 'msg-1', senderId: 'user-1', senderName: 'User', content: 'Hello', timestamp: 1700000000000, type: 'text' },
      })

      expect(useMultiChatStore.getState().unreadCounts).toEqual({ conv_2: 1 })
    })

    it('conversation_updated で会話サマリーを更新する', async () => {
      useMultiChatStore.getState().setConversations([
        { conversationId: 'conv_1', otherUserId: 'user-1', otherDisplayName: 'Friend', lastMessage: 'Old', updatedAt: 1700000000000 },
      ])

      const service = await createService()
      service.connect('test-token')
      mockWsInstances[0].simulateOpen()

      mockWsInstances[0].simulateMessage({
        type: 'conversation_updated',
        conversationId: 'conv_1',
        lastMessage: 'New message',
        updatedAt: 1700000001000,
      })

      const conv = useMultiChatStore.getState().conversations[0]
      expect(conv.lastMessage).toBe('New message')
      expect(conv.updatedAt).toBe(1700000001000)
    })
  })

  describe('subscribe / unsubscribe', () => {
    it('subscribe 後に unsubscribe すると new_message で incrementUnread になる', async () => {
      const service = await createService()
      service.connect('test-token')
      mockWsInstances[0].simulateOpen()

      service.subscribe('conv_1')
      service.unsubscribe('conv_1')

      mockWsInstances[0].simulateMessage({
        type: 'new_message',
        conversationId: 'conv_1',
        message: { id: 'msg-1', senderId: 'user-1', senderName: 'User', content: 'Hello', timestamp: 1700000000000, type: 'text' },
      })

      // unsubscribe 済みなので appendMessages ではなく incrementUnread
      expect(useMultiChatStore.getState().activeMessages).toEqual([])
      expect(useMultiChatStore.getState().unreadCounts).toEqual({ conv_1: 1 })
    })
  })

  describe('再接続', () => {
    it('接続が切れたら指数バックオフで再接続する', async () => {
      const service = await createService()
      service.connect('test-token')
      mockWsInstances[0].simulateOpen()

      // 接続切断
      mockWsInstances[0].simulateClose()
      expect(useMultiChatStore.getState().wsStatus).toBe('connecting')

      // 1秒後に再接続
      vi.advanceTimersByTime(1000)
      expect(mockWsInstances).toHaveLength(2)
    })

    it('最大試行回数を超えたら failed になる', async () => {
      const service = await createService()
      service.connect('test-token')
      mockWsInstances[0].simulateOpen()

      // 6回切断（MAX_RECONNECT_ATTEMPTS = 5 を超える）
      for (let i = 0; i < 6; i++) {
        const lastIdx = mockWsInstances.length - 1
        mockWsInstances[lastIdx].simulateClose()
        // タイマーを進めて再接続を発火
        vi.advanceTimersByTime(60000)
      }

      expect(useMultiChatStore.getState().wsStatus).toBe('failed')
    })
  })
})
