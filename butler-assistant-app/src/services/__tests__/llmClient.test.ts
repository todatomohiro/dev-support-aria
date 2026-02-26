import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { llmClient, retryWithBackoff } from '../llmClient'
import { APIError, NetworkError, RateLimitError } from '@/types'

describe('LLMClient', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  describe('sendMessage', () => {
    it('APIキーが未設定の場合はエラーをスローする', async () => {
      // APIキーをリセット（新しいインスタンスではデフォルトで空）
      llmClient.setApiKey('')

      await expect(llmClient.sendMessage('こんにちは')).rejects.toThrow(APIError)
    })

    it('ネットワークエラー時はNetworkErrorをスローする', async () => {
      llmClient.setApiKey('test-key')

      global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

      await expect(llmClient.sendMessage('こんにちは')).rejects.toThrow(NetworkError)
    })

    it('401エラー時は適切なAPIErrorをスローする', async () => {
      llmClient.setApiKey('invalid-key')

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers(),
        text: async () => 'Unauthorized',
      })

      await expect(llmClient.sendMessage('こんにちは')).rejects.toThrow(APIError)
    })

    it('429エラー時はRateLimitErrorをスローする', async () => {
      llmClient.setApiKey('test-key')

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '60' }),
        text: async () => 'Rate limit exceeded',
      })

      await expect(llmClient.sendMessage('こんにちは')).rejects.toThrow(RateLimitError)
    })

    it('Gemini APIから正常なレスポンスを受信できる', async () => {
      llmClient.setApiKey('test-key')
      llmClient.setProvider('gemini')

      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: '{"text": "かしこまりました", "motion": "bow"}' }],
            },
          },
        ],
      }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      })

      const result = await llmClient.sendMessage('こんにちは')

      expect(result.text).toBe('かしこまりました')
      expect(result.motion).toBe('bow')
    })

    it('Claude APIから正常なレスポンスを受信できる', async () => {
      llmClient.setApiKey('test-key')
      llmClient.setProvider('claude')

      const mockResponse = {
        content: [{ text: '{"text": "かしこまりました", "motion": "smile"}' }],
      }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      })

      const result = await llmClient.sendMessage('こんにちは')

      expect(result.text).toBe('かしこまりました')
      expect(result.motion).toBe('smile')
    })
  })

  describe('setProvider', () => {
    it('プロバイダーを切り替えられる', () => {
      expect(() => llmClient.setProvider('gemini')).not.toThrow()
      expect(() => llmClient.setProvider('claude')).not.toThrow()
    })
  })

  // Property 20: APIキーのログ出力防止
  describe('Property Tests', () => {
    it('Feature: butler-assistant-app, Property 20: エラーメッセージにAPIキーが含まれない', async () => {
      const sensitiveApiKey = 'super-secret-api-key-12345'
      llmClient.setApiKey(sensitiveApiKey)

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: async () => 'Internal Server Error',
      })

      try {
        await llmClient.sendMessage('test')
      } catch (error) {
        const errorMessage = (error as Error).message
        expect(errorMessage).not.toContain(sensitiveApiKey)
      }
    })
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
