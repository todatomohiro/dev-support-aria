import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SkillClientImpl } from '../skillClient'
import { APIError, NetworkError } from '@/types'

// getIdToken をモック
vi.mock('@/auth', () => ({
  getIdToken: vi.fn(() => Promise.resolve('test-access-token')),
}))

// currentPlatform をモック（デフォルトは 'web'）
vi.mock('@/platform', () => ({
  currentPlatform: 'web',
}))

// VITE_API_BASE_URL をモック
const MOCK_API_BASE_URL = 'https://api.example.com/prod'
vi.stubEnv('VITE_API_BASE_URL', MOCK_API_BASE_URL)

describe('SkillClient', () => {
  let skillClient: SkillClientImpl
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.resetAllMocks()
    skillClient = new SkillClientImpl()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  describe('getConnections', () => {
    it('接続済みサービス一覧を取得する', async () => {
      const mockConnections = [
        { service: 'google', connectedAt: 1709100000000 },
      ]

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ connections: mockConnections }),
      })

      const result = await skillClient.getConnections()

      expect(result).toEqual(mockConnections)
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toBe(`${MOCK_API_BASE_URL}/skills/connections`)
    })

    it('認証トークンを Authorization ヘッダーに含める', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ connections: [] }),
      })

      await skillClient.getConnections()

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[1].headers.Authorization).toBe('Bearer test-access-token')
    })

    it('API エラー時は APIError をスローする', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      })

      await expect(skillClient.getConnections()).rejects.toThrow(APIError)
    })

    it('ネットワークエラー時は NetworkError をスローする', async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

      await expect(skillClient.getConnections()).rejects.toThrow(NetworkError)
    })
  })

  describe('exchangeCode', () => {
    it('認可コードとリダイレクト URI をバックエンドに送信する', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      })

      await skillClient.exchangeCode('auth-code-123')

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toBe(`${MOCK_API_BASE_URL}/skills/google/callback`)
      expect(fetchCall[1].method).toBe('POST')

      const body = JSON.parse(fetchCall[1].body)
      expect(body.code).toBe('auth-code-123')
      expect(body.redirectUri).toContain('/oauth/callback')
    })

    it('API エラー時は APIError をスローする', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Invalid code',
      })

      await expect(skillClient.exchangeCode('bad-code')).rejects.toThrow(APIError)
    })
  })

  describe('disconnectGoogle', () => {
    it('DELETE /skills/google/disconnect を呼び出す', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      })

      await skillClient.disconnectGoogle()

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toBe(`${MOCK_API_BASE_URL}/skills/google/disconnect`)
      expect(fetchCall[1].method).toBe('DELETE')
    })

    it('API エラー時は APIError をスローする', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      })

      await expect(skillClient.disconnectGoogle()).rejects.toThrow(APIError)
    })
  })

  describe('startGoogleOAuth', () => {
    it('Google Client ID が未設定の場合はエラーをスローする', () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')

      expect(() => skillClient.startGoogleOAuth()).toThrow(APIError)
    })

    it('Google Client ID が設定されている場合は window.open を呼び出す', () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id')

      const mockOpen = vi.fn()
      const originalOpen = window.open
      window.open = mockOpen

      skillClient.startGoogleOAuth()

      expect(mockOpen).toHaveBeenCalledTimes(1)
      const [url, target, features] = mockOpen.mock.calls[0]
      expect(url).toContain('accounts.google.com/o/oauth2')
      expect(url).toContain('client_id=test-client-id')
      expect(url).toContain('response_type=code')
      expect(url).toContain('scope=')
      expect(target).toBe('google-oauth')
      expect(features).toContain('width=500')

      window.open = originalOpen
    })
  })

  describe('handleOAuthRedirect', () => {
    it('URL から code を正しく抽出して exchangeCode を呼び出す', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      })

      const result = await skillClient.handleOAuthRedirect(
        'com.googleusercontent.apps.133320073795-c66cpjpjbe0svqcivsoh6g86rbvdjtl5:/oauth/callback?code=auth-code-456'
      )

      expect(result).toBe(true)
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.code).toBe('auth-code-456')
      expect(body.redirectUri).toBe('com.googleusercontent.apps.133320073795-c66cpjpjbe0svqcivsoh6g86rbvdjtl5:/oauth/callback')
    })

    it('error パラメータがある場合は false を返す', async () => {
      const result = await skillClient.handleOAuthRedirect(
        'com.googleusercontent.apps.133320073795-c66cpjpjbe0svqcivsoh6g86rbvdjtl5:/oauth/callback?error=access_denied'
      )

      expect(result).toBe(false)
    })

    it('code がない場合は false を返す', async () => {
      const result = await skillClient.handleOAuthRedirect(
        'com.googleusercontent.apps.133320073795-c66cpjpjbe0svqcivsoh6g86rbvdjtl5:/oauth/callback'
      )

      expect(result).toBe(false)
    })

    it('exchangeCode が失敗した場合は false を返す', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Invalid code',
      })

      const result = await skillClient.handleOAuthRedirect(
        'com.googleusercontent.apps.133320073795-c66cpjpjbe0svqcivsoh6g86rbvdjtl5:/oauth/callback?code=bad-code'
      )

      expect(result).toBe(false)
    })
  })
})
