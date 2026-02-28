import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ConversationServiceImpl } from '../conversationService'
import { APIError, NetworkError } from '@/types'

// useAuthStore をモック
vi.mock('@/auth/authStore', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({ accessToken: 'test-access-token' })),
  },
}))

const MOCK_API_BASE_URL = 'https://api.example.com/prod'
vi.stubEnv('VITE_API_BASE_URL', MOCK_API_BASE_URL)

describe('ConversationService', () => {
  let conversationService: ConversationServiceImpl
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.resetAllMocks()
    conversationService = new ConversationServiceImpl()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  describe('listConversations', () => {
    it('GET /conversations で会話一覧を取得する', async () => {
      const mockConversations = [
        { conversationId: 'conv_1', otherUserId: 'user-2', otherDisplayName: 'User 2', lastMessage: 'こんにちは', updatedAt: 1700000000000 },
      ]

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ conversations: mockConversations }),
      })

      const result = await conversationService.listConversations()

      expect(result).toEqual(mockConversations)
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toBe(`${MOCK_API_BASE_URL}/conversations`)
    })

    it('認証トークンを含める', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ conversations: [] }),
      })

      await conversationService.listConversations()

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[1].headers.Authorization).toBe('Bearer test-access-token')
    })

    it('API エラー時は APIError をスローする', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      })

      await expect(conversationService.listConversations()).rejects.toThrow(APIError)
    })
  })

  describe('getMessages', () => {
    it('GET /conversations/{id}/messages でメッセージを取得する', async () => {
      const mockMessages = [
        { id: 'msg-1', senderId: 'user-1', senderName: 'User 1', content: 'Hello', timestamp: 1700000000000, type: 'text' },
      ]

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messages: mockMessages }),
      })

      const result = await conversationService.getMessages('conv_1')

      expect(result.messages).toEqual(mockMessages)
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toBe(`${MOCK_API_BASE_URL}/conversations/conv_1/messages`)
    })

    it('limit パラメータを渡せる', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [] }),
      })

      await conversationService.getMessages('conv_1', 20)

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toContain('limit=20')
    })

    it('before パラメータでページネーションを行う', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [], nextCursor: 'CMSG#cursor' }),
      })

      const result = await conversationService.getMessages('conv_1', undefined, 'CMSG#prev')

      expect(result.nextCursor).toBe('CMSG#cursor')
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toContain('before=CMSG%23prev')
    })
  })

  describe('sendMessage', () => {
    it('POST /conversations/{id}/messages でメッセージを送信する', async () => {
      const mockMessage = {
        id: 'msg-new',
        senderId: 'user-1',
        senderName: 'テストユーザー',
        content: 'こんにちは',
        timestamp: 1700000000000,
        type: 'text',
      }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: mockMessage }),
      })

      const result = await conversationService.sendMessage('conv_1', 'こんにちは', 'テストユーザー')

      expect(result).toEqual(mockMessage)
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toBe(`${MOCK_API_BASE_URL}/conversations/conv_1/messages`)
      expect(fetchCall[1].method).toBe('POST')
      const body = JSON.parse(fetchCall[1].body)
      expect(body.content).toBe('こんにちは')
      expect(body.senderName).toBe('テストユーザー')
    })

    it('送信失敗時は APIError をスローする', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      })

      await expect(conversationService.sendMessage('conv_1', 'test', 'user')).rejects.toThrow(APIError)
    })
  })

  describe('markAsRead', () => {
    it('POST /conversations/{id}/messages/read で既読位置を更新する', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ updated: true }),
      })

      await conversationService.markAsRead('conv_1', 1700000002000)

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toBe(`${MOCK_API_BASE_URL}/conversations/conv_1/messages/read`)
      expect(fetchCall[1].method).toBe('POST')
      const body = JSON.parse(fetchCall[1].body)
      expect(body.lastReadAt).toBe(1700000002000)
    })
  })

  describe('getMessages with otherLastReadAt', () => {
    it('レスポンスに otherLastReadAt が含まれる', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [], otherLastReadAt: 1700000001000 }),
      })

      const result = await conversationService.getMessages('conv_1')

      expect(result.otherLastReadAt).toBe(1700000001000)
    })
  })

  describe('pollNewMessages', () => {
    it('GET /conversations/{id}/messages/new?after={ts} で新着メッセージを取得する', async () => {
      const mockMessages = [
        { id: 'msg-2', senderId: 'user-2', senderName: 'User 2', content: 'New!', timestamp: 1700000001000, type: 'text' },
      ]

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messages: mockMessages }),
      })

      const result = await conversationService.pollNewMessages('conv_1', 1700000000000)

      expect(result).toEqual(mockMessages)
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toContain('/conversations/conv_1/messages/new')
      expect(fetchCall[0]).toContain('after=1700000000000')
    })

    it('新着がない場合は空配列を返す', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [] }),
      })

      const result = await conversationService.pollNewMessages('conv_1', 1700000000000)

      expect(result).toEqual([])
    })

    it('ネットワークエラー時は NetworkError をスローする', async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

      await expect(conversationService.pollNewMessages('conv_1', 0)).rejects.toThrow(NetworkError)
    })
  })
})
