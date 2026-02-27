import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ChatControllerImpl } from '../chatController'
import { llmClient } from '../llmClient'
import { motionController } from '../motionController'
import { useAppStore } from '@/stores/appStore'
import { useAuthStore } from '@/auth/authStore'
import { NetworkError, APIError, RateLimitError, ParseError } from '@/types'

// モックセットアップ
vi.mock('../llmClient', () => ({
  llmClient: {
    sendMessage: vi.fn(),
  },
}))

vi.mock('../motionController', () => ({
  motionController: {
    playMotion: vi.fn(),
    returnToIdle: vi.fn(),
  },
}))

const mockLLMClient = vi.mocked(llmClient)
const mockMotionController = vi.mocked(motionController)

// fetch モック
const mockFetch = vi.fn().mockResolvedValue({ ok: true })
vi.stubGlobal('fetch', mockFetch)

describe('ChatController', () => {
  let chatController: ChatControllerImpl

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({ ok: true })
    // ストアをリセット
    useAppStore.setState({
      messages: [],
      isLoading: false,
      currentMotion: 'idle',
      motionQueue: [],
      lastError: null,
    })
    // 認証ストアをリセット（メモリイベントはデフォルトで送信しない）
    useAuthStore.setState({ accessToken: null })
    chatController = new ChatControllerImpl()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('sendMessage', () => {
    it('メッセージ送信が正常に完了する', async () => {
      mockLLMClient.sendMessage.mockResolvedValue({
        text: 'ご主人様、かしこまりました。',
        motion: 'bow',
      })

      await chatController.sendMessage('こんにちは')

      const state = useAppStore.getState()
      expect(state.messages).toHaveLength(2)
      expect(state.messages[0].role).toBe('user')
      expect(state.messages[0].content).toBe('こんにちは')
      expect(state.messages[1].role).toBe('assistant')
      expect(state.messages[1].content).toBe('ご主人様、かしこまりました。')
    })

    it('空のメッセージは送信されない', async () => {
      await chatController.sendMessage('')
      await chatController.sendMessage('   ')

      const state = useAppStore.getState()
      expect(state.messages).toHaveLength(0)
      expect(mockLLMClient.sendMessage).not.toHaveBeenCalled()
    })

    it('ローディング状態が正しく管理される', async () => {
      mockLLMClient.sendMessage.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ text: 'test', motion: 'idle' }), 50))
      )

      const promise = chatController.sendMessage('テスト')

      // ローディング中
      expect(useAppStore.getState().isLoading).toBe(true)

      await promise

      // ローディング終了
      expect(useAppStore.getState().isLoading).toBe(false)
    })

    it('モーションが再生される', async () => {
      mockLLMClient.sendMessage.mockResolvedValue({
        text: 'test',
        motion: 'happy',
      })

      await chatController.sendMessage('テスト')

      expect(mockMotionController.playMotion).toHaveBeenCalledWith('happy')
      expect(useAppStore.getState().currentMotion).toBe('happy')
    })
  })

  describe('メモリイベント', () => {
    it('成功時にメモリイベントが送信される', async () => {
      // 環境変数とアクセストークンを設定
      vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')
      useAuthStore.setState({ accessToken: 'test-token' })

      mockLLMClient.sendMessage.mockResolvedValue({
        text: 'ご主人様、かしこまりました。',
        motion: 'bow',
      })

      await chatController.sendMessage('こんにちは')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/memory/events',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token',
          }),
          body: JSON.stringify({
            messages: [
              { role: 'user', content: 'こんにちは' },
              { role: 'assistant', content: 'ご主人様、かしこまりました。' },
            ],
          }),
        })
      )

      vi.unstubAllEnvs()
    })

    it('API URL が未設定の場合、メモリイベントは送信されない', async () => {
      vi.stubEnv('VITE_API_BASE_URL', '')
      useAuthStore.setState({ accessToken: 'test-token' })

      mockLLMClient.sendMessage.mockResolvedValue({
        text: 'test',
        motion: 'idle',
      })

      await chatController.sendMessage('テスト')

      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/memory/events'),
        expect.anything()
      )

      vi.unstubAllEnvs()
    })

    it('アクセストークンがない場合、メモリイベントは送信されない', async () => {
      vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')
      useAuthStore.setState({ accessToken: null })

      mockLLMClient.sendMessage.mockResolvedValue({
        text: 'test',
        motion: 'idle',
      })

      await chatController.sendMessage('テスト')

      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/memory/events'),
        expect.anything()
      )

      vi.unstubAllEnvs()
    })

    it('メモリイベント送信が失敗してもチャットは正常に完了する', async () => {
      vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')
      useAuthStore.setState({ accessToken: 'test-token' })
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      mockLLMClient.sendMessage.mockResolvedValue({
        text: 'ご主人様、かしこまりました。',
        motion: 'bow',
      })

      await chatController.sendMessage('こんにちは')

      // チャットメッセージは正常に追加されている
      const state = useAppStore.getState()
      expect(state.messages).toHaveLength(2)
      expect(state.messages[1].content).toBe('ご主人様、かしこまりました。')

      vi.unstubAllEnvs()
    })

    it('エラー時にはメモリイベントは送信されない', async () => {
      vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')
      useAuthStore.setState({ accessToken: 'test-token' })

      mockLLMClient.sendMessage.mockRejectedValue(new NetworkError('ネットワークエラー'))

      await chatController.sendMessage('テスト')

      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/memory/events'),
        expect.anything()
      )

      vi.unstubAllEnvs()
    })
  })

  describe('エラーハンドリング', () => {
    it('NetworkError時に適切なモーションが再生される', async () => {
      mockLLMClient.sendMessage.mockRejectedValue(new NetworkError('ネットワークエラー'))

      await chatController.sendMessage('テスト')

      expect(mockMotionController.playMotion).toHaveBeenCalledWith('bow')
      expect(useAppStore.getState().currentMotion).toBe('bow')
    })

    it('RateLimitError時に適切なモーションが再生される', async () => {
      mockLLMClient.sendMessage.mockRejectedValue(new RateLimitError('レート制限'))

      await chatController.sendMessage('テスト')

      expect(mockMotionController.playMotion).toHaveBeenCalledWith('nervous')
    })

    it('APIError時に適切なモーションが再生される', async () => {
      mockLLMClient.sendMessage.mockRejectedValue(new APIError('APIエラー', 500))

      await chatController.sendMessage('テスト')

      expect(mockMotionController.playMotion).toHaveBeenCalledWith('bow')
    })

    it('ParseError時に適切なモーションが再生される', async () => {
      mockLLMClient.sendMessage.mockRejectedValue(new ParseError('パースエラー'))

      await chatController.sendMessage('テスト')

      expect(mockMotionController.playMotion).toHaveBeenCalledWith('confused')
    })

    it('エラー時にエラーメッセージがアシスタントメッセージとして追加される', async () => {
      mockLLMClient.sendMessage.mockRejectedValue(new NetworkError('ネットワークエラー'))

      await chatController.sendMessage('テスト')

      const state = useAppStore.getState()
      expect(state.messages).toHaveLength(2)
      expect(state.messages[1].role).toBe('assistant')
      expect(state.messages[1].content).toContain('ネット')
    })

    it('AppErrorがストアに設定される', async () => {
      const error = new NetworkError('ネットワークエラー')
      mockLLMClient.sendMessage.mockRejectedValue(error)

      await chatController.sendMessage('テスト')

      expect(useAppStore.getState().lastError).toBe(error)
    })

    it('エラー後もローディングが終了する', async () => {
      mockLLMClient.sendMessage.mockRejectedValue(new Error('エラー'))

      await chatController.sendMessage('テスト')

      expect(useAppStore.getState().isLoading).toBe(false)
    })
  })

  describe('clearHistory', () => {
    it('会話履歴がクリアされる', async () => {
      // メッセージを追加
      mockLLMClient.sendMessage.mockResolvedValue({
        text: 'test',
        motion: 'idle',
      })
      await chatController.sendMessage('テスト')

      expect(useAppStore.getState().messages).toHaveLength(2)

      // クリア
      chatController.clearHistory()

      expect(useAppStore.getState().messages).toHaveLength(0)
      expect(mockMotionController.returnToIdle).toHaveBeenCalled()
    })
  })

  describe('returnToIdle', () => {
    it('待機状態に戻る', () => {
      useAppStore.setState({ currentMotion: 'happy' })

      chatController.returnToIdle()

      expect(mockMotionController.returnToIdle).toHaveBeenCalled()
      expect(useAppStore.getState().currentMotion).toBe('idle')
    })
  })

  describe('エラーメッセージ', () => {
    it('NetworkErrorの場合、適切なメッセージが表示される', async () => {
      mockLLMClient.sendMessage.mockRejectedValue(new NetworkError(''))

      await chatController.sendMessage('テスト')

      const state = useAppStore.getState()
      const lastMessage = state.messages[state.messages.length - 1]
      expect(lastMessage.content).toContain('ネットがつながらない')
    })

    it('RateLimitErrorの場合、適切なメッセージが表示される', async () => {
      mockLLMClient.sendMessage.mockRejectedValue(new RateLimitError(''))

      await chatController.sendMessage('テスト')

      const state = useAppStore.getState()
      const lastMessage = state.messages[state.messages.length - 1]
      expect(lastMessage.content).toContain('混み合ってる')
    })

    it('APIErrorの場合、適切なメッセージが表示される', async () => {
      mockLLMClient.sendMessage.mockRejectedValue(new APIError('', 401))

      await chatController.sendMessage('テスト')

      const state = useAppStore.getState()
      const lastMessage = state.messages[state.messages.length - 1]
      expect(lastMessage.content).toContain('うまくいかなかった')
    })

    it('ParseErrorの場合、適切なメッセージが表示される', async () => {
      mockLLMClient.sendMessage.mockRejectedValue(new ParseError(''))

      await chatController.sendMessage('テスト')

      const state = useAppStore.getState()
      const lastMessage = state.messages[state.messages.length - 1]
      expect(lastMessage.content).toContain('うまく返事できなかった')
    })

    it('不明なエラーの場合、適切なメッセージが表示される', async () => {
      mockLLMClient.sendMessage.mockRejectedValue(new Error('不明なエラー'))

      await chatController.sendMessage('テスト')

      const state = useAppStore.getState()
      const lastMessage = state.messages[state.messages.length - 1]
      expect(lastMessage.content).toContain('エラーが出ちゃった')
    })
  })
})
