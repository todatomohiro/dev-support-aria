import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { llmClient, retryWithBackoff, buildSystemPrompt, BUTLER_SYSTEM_PROMPT, buildSkillSystemPrompt } from '../llmClient'
import { APIError, NetworkError, RateLimitError, ParseError } from '@/types'
import type { UserProfile } from '@/types'
import { getIdToken } from '@/auth'

// getIdToken をモック
vi.mock('@/auth', () => ({
  getIdToken: vi.fn(() => Promise.resolve('test-access-token')),
}))

// VITE_API_BASE_URL をモック
const MOCK_API_BASE_URL = 'https://api.example.com/prod'
vi.stubEnv('VITE_API_BASE_URL', MOCK_API_BASE_URL)

describe('LLMClient', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.resetAllMocks()
    // getIdToken のモックをリセット
    vi.mocked(getIdToken).mockResolvedValue('test-access-token')
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  describe('sendMessage', () => {
    it('Lambda /llm/chat を正しいペイロードで呼び出す', async () => {
      const mockResponse = { content: '{"text": "こんにちは！", "motion": "smile", "emotion": "happy"}' }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      })

      await llmClient.sendMessage('こんにちは', 'test-session-id')

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toBe(`${MOCK_API_BASE_URL}/llm/chat`)
      expect(fetchCall[1].method).toBe('POST')

      const body = JSON.parse(fetchCall[1].body)
      expect(body.message).toBe('こんにちは')
      expect(body.sessionId).toBe('test-session-id')
      expect(body.systemPrompt).toContain(BUTLER_SYSTEM_PROMPT)
      expect(body.history).toBeUndefined()
    })

    it('認証トークンを Authorization ヘッダーに含める', async () => {
      const mockResponse = { content: '{"text": "はい！", "motion": "nod", "emotion": "neutral"}' }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      })

      await llmClient.sendMessage('テスト', 'test-session-id')

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[1].headers.Authorization).toBe('Bearer test-access-token')
    })

    it('Lambda からの正常レスポンスを StructuredResponse にパースする', async () => {
      const mockResponse = { content: '{"text": "かしこまりました", "motion": "bow", "emotion": "happy"}' }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      })

      const result = await llmClient.sendMessage('お願いします', 'test-session-id')

      expect(result.text).toBe('かしこまりました')
      expect(result.motion).toBe('bow')
      expect(result.emotion).toBe('happy')
    })

    it('ネットワークエラー時は NetworkError をスローする', async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

      await expect(llmClient.sendMessage('こんにちは', 'test-session-id')).rejects.toThrow(NetworkError)
    })

    it('Lambda の 429 レスポンス時は RateLimitError をスローする', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '60' }),
        text: async () => 'Rate limit exceeded',
      })

      await expect(llmClient.sendMessage('こんにちは', 'test-session-id')).rejects.toThrow(RateLimitError)
    })

    it('Lambda の 500 レスポンス時は APIError をスローする', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: async () => 'Internal Server Error',
      })

      await expect(llmClient.sendMessage('こんにちは', 'test-session-id')).rejects.toThrow(APIError)
    })

    it('mapData を含む JSON レスポンスを正しくパースする', async () => {
      const mapData = {
        center: { lat: 35.6595, lng: 139.7004 },
        zoom: 15,
        markers: [{ lat: 35.6595, lng: 139.7004, title: 'カフェA', address: '渋谷区1-1', rating: 4.5 }],
      }
      const mockResponse = {
        content: JSON.stringify({
          text: '渋谷のカフェだよ！',
          motion: 'smile',
          emotion: 'happy',
          mapData,
        }),
      }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      })

      const result = await llmClient.sendMessage('渋谷のカフェを教えて', 'test-session-id')

      expect(result.text).toBe('渋谷のカフェだよ！')
      expect(result.mapData).toEqual(mapData)
    })

    it('JSON 形式でない応答はフォールバックで idle モーションになる', async () => {
      const mockResponse = { content: 'これはJSONではありません' }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      })

      const result = await llmClient.sendMessage('こんにちは', 'test-session-id')

      expect(result.text).toBe('これはJSONではありません')
      expect(result.motion).toBe('idle')
      expect(result.emotion).toBe('neutral')
    })

    it('sessionId をリクエストボディに含めて送信する', async () => {
      const mockResponse = { content: '{"text": "元気だよ！", "motion": "smile", "emotion": "happy"}' }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      })

      await llmClient.sendMessage('元気？', 'my-session-123')

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.sessionId).toBe('my-session-123')
      expect(body.history).toBeUndefined()
    })

    it('マークダウンコードブロックで囲まれた JSON を正しくパースする', async () => {
      const mockResponse = { content: '```json\n{"text": "テスト", "motion": "idle", "emotion": "neutral"}\n```' }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      })

      const result = await llmClient.sendMessage('テスト', 'test-session-id')

      expect(result.text).toBe('テスト')
      expect(result.motion).toBe('idle')
    })

    it('imageBase64 が指定された場合リクエストボディに含まれる', async () => {
      const mockResponse = { content: '{"text": "猫だね！", "motion": "smile", "emotion": "happy"}' }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      })

      await llmClient.sendMessage('これ何？', 'test-session-id', 'aW1hZ2VkYXRh')

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.imageBase64).toBe('aW1hZ2VkYXRh')
    })

    it('imageBase64 が未指定の場合リクエストボディに含まれない', async () => {
      const mockResponse = { content: '{"text": "はい！", "motion": "nod", "emotion": "neutral"}' }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      })

      await llmClient.sendMessage('こんにちは', 'test-session-id')

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.imageBase64).toBeUndefined()
    })

    it('userLocation が指定された場合リクエストボディに含まれる', async () => {
      const mockResponse = { content: '{"text": "近くのカフェだよ！", "motion": "smile", "emotion": "happy"}' }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      })

      await llmClient.sendMessage('近くのカフェ教えて', 'test-session-id', undefined, undefined, { lat: 35.6812, lng: 139.7671 })

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.userLocation).toEqual({ lat: 35.6812, lng: 139.7671 })
    })

    it('userLocation が未指定の場合リクエストボディに含まれない', async () => {
      const mockResponse = { content: '{"text": "はい！", "motion": "nod", "emotion": "neutral"}' }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      })

      await llmClient.sendMessage('こんにちは', 'test-session-id')

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.userLocation).toBeUndefined()
    })

    it('401 エラー時は認証エラーメッセージを返す', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers(),
        text: async () => 'Unauthorized',
      })

      await expect(llmClient.sendMessage('こんにちは', 'test-session-id')).rejects.toThrow('認証エラーです')
    })
  })
})

describe('buildSystemPrompt', () => {
  it('プロフィール未設定の場合はベースプロンプトのみ返す', () => {
    const result = buildSystemPrompt()
    expect(result).toBe(BUTLER_SYSTEM_PROMPT + buildSkillSystemPrompt())
  })

  it('プロフィールがundefinedの場合はベースプロンプトのみ返す', () => {
    const result = buildSystemPrompt(undefined)
    expect(result).toBe(BUTLER_SYSTEM_PROMPT + buildSkillSystemPrompt())
  })

  it('ニックネームが空の場合はベースプロンプトのみ返す', () => {
    const profile: UserProfile = { nickname: '', honorific: '', gender: '' }
    const result = buildSystemPrompt(profile)
    expect(result).toBe(BUTLER_SYSTEM_PROMPT + buildSkillSystemPrompt())
  })

  it('ニックネームのみ設定された場合、呼び捨てで呼ぶ指示が追加される', () => {
    const profile: UserProfile = { nickname: '太郎', honorific: '', gender: '' }
    const result = buildSystemPrompt(profile)
    expect(result).toContain('ユーザーの名前は「太郎」です')
    expect(result).toContain('「太郎」と呼んでください')
  })

  it('ニックネームと敬称が設定された場合、敬称付きで呼ぶ指示が追加される', () => {
    const profile: UserProfile = { nickname: '太郎', honorific: 'さん', gender: '' }
    const result = buildSystemPrompt(profile)
    expect(result).toContain('「太郎さん」と呼んでください')
  })

  it('敬称「くん」が正しく反映される', () => {
    const profile: UserProfile = { nickname: '太郎', honorific: 'くん', gender: '' }
    const result = buildSystemPrompt(profile)
    expect(result).toContain('「太郎くん」と呼んでください')
  })

  it('敬称「様」が正しく反映される', () => {
    const profile: UserProfile = { nickname: '太郎', honorific: '様', gender: '' }
    const result = buildSystemPrompt(profile)
    expect(result).toContain('「太郎様」と呼んでください')
  })

  it('性別が女性の場合、その情報が追加される', () => {
    const profile: UserProfile = { nickname: '花子', honorific: 'さん', gender: 'female' }
    const result = buildSystemPrompt(profile)
    expect(result).toContain('ユーザーは女性です')
  })

  it('性別が男性の場合、その情報が追加される', () => {
    const profile: UserProfile = { nickname: '太郎', honorific: 'くん', gender: 'male' }
    const result = buildSystemPrompt(profile)
    expect(result).toContain('ユーザーは男性です')
  })

  it('性別が未設定の場合、性別情報は追加されない', () => {
    const profile: UserProfile = { nickname: '太郎', honorific: '', gender: '' }
    const result = buildSystemPrompt(profile)
    expect(result).not.toContain('ユーザーは女性です')
    expect(result).not.toContain('ユーザーは男性です')
  })

  it('ベースプロンプトを含んでいる', () => {
    const profile: UserProfile = { nickname: '太郎', honorific: 'さん', gender: 'male' }
    const result = buildSystemPrompt(profile)
    expect(result).toContain(BUTLER_SYSTEM_PROMPT)
  })
})

describe('setUserProfile', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('プロフィール設定後のsendMessageでプロンプトにユーザー情報が含まれる', async () => {
    llmClient.setUserProfile({ nickname: '太郎', honorific: 'さん', gender: 'male' })

    const mockResponse = { content: '{"text": "太郎さん、こんにちは！", "motion": "smile", "emotion": "happy"}' }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    })

    await llmClient.sendMessage('こんにちは', 'test-session-id')

    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    expect(body.systemPrompt).toContain('太郎さん')
    expect(body.systemPrompt).toContain('ユーザーは男性です')
  })
})

describe('retryWithBackoff', () => {
  it('成功した場合は即座に結果を返す', async () => {
    const fn = vi.fn().mockResolvedValue('success')

    const result = await retryWithBackoff(fn, 3, 10)

    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('失敗後にリトライして成功する', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('success')

    const result = await retryWithBackoff(fn, 3, 10)

    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('401エラーはリトライせずに即座に失敗する', async () => {
    const fn = vi.fn().mockRejectedValue(new APIError('Unauthorized', 401))

    await expect(retryWithBackoff(fn, 3, 10)).rejects.toThrow(APIError)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('最大リトライ回数に達すると失敗する', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fail'))

    await expect(retryWithBackoff(fn, 3, 10)).rejects.toThrow('always fail')
    expect(fn).toHaveBeenCalledTimes(3)
  })
})
