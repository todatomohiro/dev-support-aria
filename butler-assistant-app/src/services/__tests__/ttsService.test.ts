import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TtsServiceImpl } from '../ttsService'
import { useAuthStore } from '@/auth/authStore'

// useAuthStore をモック
vi.mock('@/auth/authStore', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({ accessToken: 'test-access-token' })),
  },
}))

// VITE_API_BASE_URL をモック
const MOCK_API_BASE_URL = 'https://api.example.com/prod'
vi.stubEnv('VITE_API_BASE_URL', MOCK_API_BASE_URL)

/**
 * jsdom の Audio は play() で ended/pause を発火しないため
 * play() 後に ended イベントを自動発火するモックを設定
 */
function mockAudioAutoEnd() {
  const originalAudio = global.Audio
  const MockAudio = vi.fn().mockImplementation((url?: string) => {
    const audio = new originalAudio(url)
    const originalPlay = audio.play.bind(audio)
    audio.play = vi.fn().mockImplementation(async () => {
      try { await originalPlay() } catch { /* jsdom の NotImplemented を無視 */ }
      // play 後に ended イベントを非同期発火
      setTimeout(() => audio.dispatchEvent(new Event('ended')), 0)
    })
    return audio
  }) as unknown as typeof Audio
  global.Audio = MockAudio
  return () => { global.Audio = originalAudio }
}

describe('TtsServiceImpl', () => {
  let tts: TtsServiceImpl
  const originalFetch = global.fetch
  let restoreAudio: () => void

  beforeEach(() => {
    vi.resetAllMocks()
    tts = new TtsServiceImpl()
    vi.mocked(useAuthStore.getState).mockReturnValue({
      accessToken: 'test-access-token',
    } as ReturnType<typeof useAuthStore.getState>)
    restoreAudio = mockAudioAutoEnd()
  })

  afterEach(() => {
    restoreAudio()
    global.fetch = originalFetch
  })

  describe('URL 除去（stripUrls）', () => {
    it('URL を含むテキストから URL が除去された状態で Polly API に送信される', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ audio: btoa('fake-audio') }),
      })
      global.fetch = mockFetch

      await tts.synthesizeAndPlay('こちらを参照してください https://example.com/path 以上です')

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.text).toBe('こちらを参照してください 以上です')
      expect(body.text).not.toContain('https://')
    })

    it('複数の URL を含むテキストからすべての URL が除去される', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ audio: btoa('fake-audio') }),
      })
      global.fetch = mockFetch

      await tts.synthesizeAndPlay('リンク1: https://example.com リンク2: http://test.org/page')

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.text).toBe('リンク1: リンク2:')
    })

    it('URL のみのテキストは API 呼び出しをスキップする', async () => {
      const mockFetch = vi.fn()
      global.fetch = mockFetch

      await tts.synthesizeAndPlay('https://example.com/path')

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('URL を含まないテキストはそのまま送信される', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ audio: btoa('fake-audio') }),
      })
      global.fetch = mockFetch

      await tts.synthesizeAndPlay('こんにちは、ご主人様')

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.text).toBe('こんにちは、ご主人様')
    })
  })
})
