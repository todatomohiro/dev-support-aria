import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FriendServiceImpl } from '../friendService'
import { APIError, NetworkError } from '@/types'

// useAuthStore をモック
vi.mock('@/auth/authStore', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({ accessToken: 'test-access-token' })),
  },
}))

const MOCK_API_BASE_URL = 'https://api.example.com/prod'
vi.stubEnv('VITE_API_BASE_URL', MOCK_API_BASE_URL)

describe('FriendService', () => {
  let friendService: FriendServiceImpl
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.resetAllMocks()
    friendService = new FriendServiceImpl()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  describe('generateCode', () => {
    it('POST /friends/code でフレンドコードを生成する', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ code: 'ABCD1234' }),
      })

      const result = await friendService.generateCode()

      expect(result).toEqual({ code: 'ABCD1234' })
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toBe(`${MOCK_API_BASE_URL}/friends/code`)
      expect(fetchCall[1].method).toBe('POST')
    })

    it('認証トークンを Authorization ヘッダーに含める', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ code: 'ABCD1234' }),
      })

      await friendService.generateCode()

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[1].headers.Authorization).toBe('Bearer test-access-token')
    })

    it('API エラー時は APIError をスローする', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      })

      await expect(friendService.generateCode()).rejects.toThrow(APIError)
    })

    it('ネットワークエラー時は NetworkError をスローする', async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

      await expect(friendService.generateCode()).rejects.toThrow(NetworkError)
    })
  })

  describe('getCode', () => {
    it('GET /friends/code でフレンドコードを取得する', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ code: 'ABCD1234' }),
      })

      const result = await friendService.getCode()

      expect(result).toEqual({ code: 'ABCD1234' })
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toBe(`${MOCK_API_BASE_URL}/friends/code`)
    })

    it('コードがない場合は null を返す', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ code: null }),
      })

      const result = await friendService.getCode()

      expect(result).toEqual({ code: null })
    })
  })

  describe('linkByCode', () => {
    it('POST /friends/link でフレンドリンクを作成する', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ conversationId: 'conv_123', friendUserId: 'user-456' }),
      })

      const result = await friendService.linkByCode('WXYZ5678', 'テストユーザー')

      expect(result).toEqual({ conversationId: 'conv_123', friendUserId: 'user-456' })
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toBe(`${MOCK_API_BASE_URL}/friends/link`)
      expect(fetchCall[1].method).toBe('POST')
      const body = JSON.parse(fetchCall[1].body)
      expect(body.code).toBe('WXYZ5678')
      expect(body.displayName).toBe('テストユーザー')
    })

    it('無効なコードの場合は APIError をスローする', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => '無効なフレンドコードです',
      })

      await expect(friendService.linkByCode('INVALID', 'テスト')).rejects.toThrow(APIError)
    })
  })

  describe('listFriends', () => {
    it('GET /friends でフレンド一覧を取得する', async () => {
      const mockFriends = [
        { friendUserId: 'user-1', displayName: 'Friend 1', linkedAt: 1700000000000 },
        { friendUserId: 'user-2', displayName: 'Friend 2', linkedAt: 1700100000000 },
      ]

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ friends: mockFriends }),
      })

      const result = await friendService.listFriends()

      expect(result).toEqual(mockFriends)
      expect(result).toHaveLength(2)
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toBe(`${MOCK_API_BASE_URL}/friends`)
    })

    it('フレンドがいない場合は空配列を返す', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ friends: [] }),
      })

      const result = await friendService.listFriends()

      expect(result).toEqual([])
    })
  })
})
