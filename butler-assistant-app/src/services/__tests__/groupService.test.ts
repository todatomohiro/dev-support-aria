import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GroupServiceImpl } from '../groupService'
import { APIError, NetworkError } from '@/types'

// useAuthStore をモック
vi.mock('@/auth/authStore', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({ accessToken: 'test-access-token' })),
  },
}))

const MOCK_API_BASE_URL = 'https://api.example.com/prod'
vi.stubEnv('VITE_API_BASE_URL', MOCK_API_BASE_URL)

describe('GroupService', () => {
  let groupService: GroupServiceImpl
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.resetAllMocks()
    groupService = new GroupServiceImpl()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  describe('listGroups', () => {
    it('GET /groups でグループ一覧を取得する', async () => {
      const mockGroups = [
        { groupId: 'g1', groupName: 'テストグループ', lastMessage: 'Hello', updatedAt: 1700000000000 },
      ]
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ conversations: mockGroups }),
      })

      const result = await groupService.listGroups()

      expect(result).toEqual(mockGroups)
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toBe(`${MOCK_API_BASE_URL}/groups`)
    })

    it('認証トークンを Authorization ヘッダーに含める', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ conversations: [] }),
      })

      await groupService.listGroups()

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[1].headers.Authorization).toBe('Bearer test-access-token')
    })

    it('グループがない場合は空配列を返す', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ conversations: [] }),
      })

      const result = await groupService.listGroups()

      expect(result).toEqual([])
    })
  })

  describe('createGroup', () => {
    it('POST /groups でグループを作成する', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ groupId: 'g1', groupName: 'テスト' }),
      })

      const result = await groupService.createGroup('テスト')

      expect(result).toEqual({ groupId: 'g1', groupName: 'テスト' })
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toBe(`${MOCK_API_BASE_URL}/groups`)
      expect(fetchCall[1].method).toBe('POST')
      expect(JSON.parse(fetchCall[1].body)).toEqual({ groupName: 'テスト' })
    })
  })

  describe('getMessages', () => {
    it('GET /groups/{id}/messages でメッセージを取得し古い順に反転する', async () => {
      const apiMessages = [
        { id: 'm2', senderId: 'u1', senderName: 'A', content: 'New', timestamp: 2000, type: 'text' },
        { id: 'm1', senderId: 'u2', senderName: 'B', content: 'Old', timestamp: 1000, type: 'text' },
      ]
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messages: apiMessages }),
      })

      const result = await groupService.getMessages('g1')

      // 反転されて古い順になる
      expect(result.messages[0].id).toBe('m1')
      expect(result.messages[1].id).toBe('m2')
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toBe(`${MOCK_API_BASE_URL}/groups/g1/messages`)
    })

    it('limit と before パラメータをクエリストリングに含める', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [] }),
      })

      await groupService.getMessages('g1', 10, 'cursor-abc')

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toContain('limit=10')
      expect(fetchCall[0]).toContain('before=cursor-abc')
    })

    it('nextCursor を返す', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [], nextCursor: 'next-cursor' }),
      })

      const result = await groupService.getMessages('g1')

      expect(result.nextCursor).toBe('next-cursor')
    })
  })

  describe('sendMessage', () => {
    it('POST /groups/{id}/messages でメッセージを送信する', async () => {
      const mockMessage = { id: 'm1', senderId: 'u1', senderName: 'User', content: 'Hello', timestamp: 1700000000000, type: 'text' }
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: mockMessage }),
      })

      const result = await groupService.sendMessage('g1', 'Hello', 'User')

      expect(result).toEqual(mockMessage)
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toBe(`${MOCK_API_BASE_URL}/groups/g1/messages`)
      expect(fetchCall[1].method).toBe('POST')
      expect(JSON.parse(fetchCall[1].body)).toEqual({ content: 'Hello', senderName: 'User' })
    })
  })

  describe('pollNewMessages', () => {
    it('GET /groups/{id}/messages/new で新着メッセージを取得する', async () => {
      const mockMessages = [
        { id: 'm1', senderId: 'u1', senderName: 'User', content: 'Hi', timestamp: 1700000001000, type: 'text' },
      ]
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messages: mockMessages }),
      })

      const result = await groupService.pollNewMessages('g1', 1700000000000)

      expect(result).toEqual(mockMessages)
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toContain('/groups/g1/messages/new')
      expect(fetchCall[0]).toContain('after=1700000000000')
    })
  })

  describe('markAsRead', () => {
    it('POST /groups/{id}/messages/read で既読位置を更新する', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      })

      await groupService.markAsRead('g1', 1700000000000)

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toBe(`${MOCK_API_BASE_URL}/groups/g1/messages/read`)
      expect(fetchCall[1].method).toBe('POST')
      expect(JSON.parse(fetchCall[1].body)).toEqual({ lastReadAt: 1700000000000 })
    })
  })

  describe('addMember', () => {
    it('POST /groups/{id}/members で userId 指定でメンバーを追加する', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ userId: 'u2', nickname: 'User2' }),
      })

      const result = await groupService.addMember('g1', { userId: 'u2' })

      expect(result).toEqual({ userId: 'u2', nickname: 'User2' })
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toBe(`${MOCK_API_BASE_URL}/groups/g1/members`)
      expect(fetchCall[1].method).toBe('POST')
      expect(JSON.parse(fetchCall[1].body)).toEqual({ userId: 'u2' })
    })

    it('userCode 指定でメンバーを追加する', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ userId: 'u2', nickname: 'User2' }),
      })

      const result = await groupService.addMember('g1', { userCode: 'ABCD1234' })

      expect(result).toEqual({ userId: 'u2', nickname: 'User2' })
      const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
      expect(body).toEqual({ userCode: 'ABCD1234' })
    })
  })

  describe('leaveGroup', () => {
    it('DELETE /groups/{id}/members/me でグループを退出する', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      })

      await groupService.leaveGroup('g1')

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toBe(`${MOCK_API_BASE_URL}/groups/g1/members/me`)
      expect(fetchCall[1].method).toBe('DELETE')
    })
  })

  describe('getMembers', () => {
    it('GET /groups/{id}/members でメンバー一覧を取得する', async () => {
      const mockResponse = {
        members: [
          { userId: 'u1', nickname: 'User1' },
          { userId: 'u2', nickname: 'User2' },
        ],
        groupName: 'テストグループ',
      }
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      })

      const result = await groupService.getMembers('g1')

      expect(result).toEqual(mockResponse)
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toBe(`${MOCK_API_BASE_URL}/groups/g1/members`)
    })
  })

  describe('エラーハンドリング', () => {
    it('API エラー時は APIError をスローする', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      })

      await expect(groupService.listGroups()).rejects.toThrow(APIError)
    })

    it('ネットワークエラー時は NetworkError をスローする', async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

      await expect(groupService.listGroups()).rejects.toThrow(NetworkError)
    })

    it('API Base URL 未設定時は APIError をスローする', async () => {
      vi.stubEnv('VITE_API_BASE_URL', '')
      const service = new GroupServiceImpl()

      await expect(service.listGroups()).rejects.toThrow(APIError)
    })
  })
})
