import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ChatControllerImpl } from '../chatController'
import { llmClient } from '../llmClient'
import { motionController } from '../motionController'
import { useAppStore } from '@/stores/appStore'
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

describe('ChatController', () => {
  let chatController: ChatControllerImpl

  beforeEach(() => {
    vi.clearAllMocks()
    // ストアをリセット
    useAppStore.setState({
      messages: [],
      isLoading: false,
      currentMotion: 'idle',
      motionQueue: [],
      lastError: null,
    })
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
      expect(state.messages[1].content).toContain('ネットワーク接続')
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
      expect(lastMessage.content).toContain('インターネット接続')
    })

    it('RateLimitErrorの場合、適切なメッセージが表示される', async () => {
      mockLLMClient.sendMessage.mockRejectedValue(new RateLimitError(''))

      await chatController.sendMessage('テスト')

      const state = useAppStore.getState()
      const lastMessage = state.messages[state.messages.length - 1]
      expect(lastMessage.content).toContain('リクエストが集中')
    })

    it('APIErrorの場合、適切なメッセージが表示される', async () => {
      mockLLMClient.sendMessage.mockRejectedValue(new APIError('', 401))

      await chatController.sendMessage('テスト')

      const state = useAppStore.getState()
      const lastMessage = state.messages[state.messages.length - 1]
      expect(lastMessage.content).toContain('APIキー')
    })

    it('ParseErrorの場合、適切なメッセージが表示される', async () => {
      mockLLMClient.sendMessage.mockRejectedValue(new ParseError(''))

      await chatController.sendMessage('テスト')

      const state = useAppStore.getState()
      const lastMessage = state.messages[state.messages.length - 1]
      expect(lastMessage.content).toContain('処理中にエラー')
    })

    it('不明なエラーの場合、適切なメッセージが表示される', async () => {
      mockLLMClient.sendMessage.mockRejectedValue(new Error('不明なエラー'))

      await chatController.sendMessage('テスト')

      const state = useAppStore.getState()
      const lastMessage = state.messages[state.messages.length - 1]
      expect(lastMessage.content).toContain('予期せぬエラー')
    })
  })
})
