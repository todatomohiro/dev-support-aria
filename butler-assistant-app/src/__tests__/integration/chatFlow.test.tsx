import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { useAppStore } from '@/stores'
import { ChatUI } from '@/components'
import { chatController } from '@/services/chatController'
import { llmClient } from '@/services'
import type { StructuredResponse } from '@/types'

// LLM Clientをモック
vi.mock('@/services/llmClient', () => ({
  llmClient: {
    sendMessage: vi.fn(),
    setUserProfile: vi.fn(),
  },
}))

describe('チャットフロー統合テスト', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // ストアをリセット
    const store = useAppStore.getState()
    store.clearMessages()
    store.setLoading(false)
    store.setError(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('メッセージ送信フロー', () => {
    it('ユーザーメッセージを送信し、アシスタントの応答を受け取る', async () => {
      // モックレスポンスを設定
      const mockResponse: StructuredResponse = {
        text: 'お役に立てて光栄です、ご主人様。',
        emotion: 'happy',
        motion: 'bow',
        actions: [],
      }
      vi.mocked(llmClient.sendMessage).mockResolvedValue(mockResponse)

      // ChatUIをレンダリング
      const store = useAppStore.getState()
      render(
        <ChatUI
          messages={store.messages}
          isLoading={store.isLoading}
          onSendMessage={async (text) => {
            await chatController.sendMessage(text)
          }}
        />
      )

      // メッセージを入力
      const input = screen.getByTestId('chat-input')
      fireEvent.change(input, { target: { value: 'こんにちは' } })

      // 送信ボタンをクリック
      const sendButton = screen.getByTestId('send-button')
      await act(async () => {
        fireEvent.click(sendButton)
      })

      // LLM Clientが呼ばれたことを確認
      await waitFor(() => {
        expect(llmClient.sendMessage).toHaveBeenCalledWith(
          'こんにちは',
          expect.objectContaining({
            messages: expect.any(Array),
            maxLength: expect.any(Number),
          })
        )
      })
    })

    it('ローディング中は送信ボタンが無効化される', async () => {
      // 遅延レスポンスを設定
      vi.mocked(llmClient.sendMessage).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({
          text: 'テスト応答',
          emotion: 'neutral',
          motion: 'idle',
          actions: [],
        }), 1000))
      )

      const store = useAppStore.getState()
      const { rerender } = render(
        <ChatUI
          messages={store.messages}
          isLoading={false}
          onSendMessage={async (text) => {
            store.setLoading(true)
            await chatController.sendMessage(text)
            store.setLoading(false)
          }}
        />
      )

      // メッセージを入力して送信
      const input = screen.getByTestId('chat-input')
      fireEvent.change(input, { target: { value: 'テスト' } })

      const sendButton = screen.getByTestId('send-button')
      fireEvent.click(sendButton)

      // ローディング状態で再レンダリング
      rerender(
        <ChatUI
          messages={store.messages}
          isLoading={true}
          onSendMessage={async () => {}}
        />
      )

      // 送信ボタンが無効化されていることを確認
      expect(sendButton).toBeDisabled()
    })

    it('空のメッセージは送信されない', async () => {
      const store = useAppStore.getState()
      render(
        <ChatUI
          messages={store.messages}
          isLoading={false}
          onSendMessage={async (text) => {
            await chatController.sendMessage(text)
          }}
        />
      )

      // 空の状態で送信ボタンをクリック
      const sendButton = screen.getByTestId('send-button')
      expect(sendButton).toBeDisabled()

      // LLM Clientが呼ばれていないことを確認
      expect(llmClient.sendMessage).not.toHaveBeenCalled()
    })
  })

  describe('メッセージ履歴の表示', () => {
    it('メッセージが時系列順に表示される', () => {
      const messages = [
        { id: '1', role: 'user' as const, content: 'メッセージ1', timestamp: 1000 },
        { id: '2', role: 'assistant' as const, content: 'メッセージ2', timestamp: 2000 },
        { id: '3', role: 'user' as const, content: 'メッセージ3', timestamp: 3000 },
      ]

      render(
        <ChatUI
          messages={messages}
          isLoading={false}
          onSendMessage={async () => {}}
        />
      )

      const bubbles = screen.getAllByTestId('message-bubble')
      expect(bubbles).toHaveLength(3)

      // 時系列順に表示されていることを確認
      expect(bubbles[0]).toHaveAttribute('data-timestamp', '1000')
      expect(bubbles[1]).toHaveAttribute('data-timestamp', '2000')
      expect(bubbles[2]).toHaveAttribute('data-timestamp', '3000')
    })

    it('ユーザーとアシスタントのメッセージが区別される', () => {
      const messages = [
        { id: '1', role: 'user' as const, content: 'ユーザーメッセージ', timestamp: 1000 },
        { id: '2', role: 'assistant' as const, content: 'アシスタントメッセージ', timestamp: 2000 },
      ]

      render(
        <ChatUI
          messages={messages}
          isLoading={false}
          onSendMessage={async () => {}}
        />
      )

      const bubbles = screen.getAllByTestId('message-bubble')
      expect(bubbles[0]).toHaveAttribute('data-role', 'user')
      expect(bubbles[1]).toHaveAttribute('data-role', 'assistant')
    })
  })

  describe('エラーハンドリング', () => {
    it('ネットワークエラー時にエラーメッセージが表示される', async () => {
      const { NetworkError } = await import('@/types')
      vi.mocked(llmClient.sendMessage).mockRejectedValue(
        new NetworkError('ネットワークエラー')
      )

      const store = useAppStore.getState()
      render(
        <ChatUI
          messages={store.messages}
          isLoading={false}
          onSendMessage={async (text) => {
            await chatController.sendMessage(text)
          }}
        />
      )

      // メッセージを入力して送信
      const input = screen.getByTestId('chat-input')
      fireEvent.change(input, { target: { value: 'テスト' } })

      const sendButton = screen.getByTestId('send-button')
      await act(async () => {
        fireEvent.click(sendButton)
      })

      // エラーがストアに設定されることを確認
      await waitFor(() => {
        const state = useAppStore.getState()
        expect(state.lastError).not.toBeNull()
      })
    })
  })
})

describe('ストア統合テスト', () => {
  beforeEach(() => {
    const store = useAppStore.getState()
    store.clearMessages()
    store.setError(null)
    store.setCurrentMotion(null)
    // モーションキューをクリア
    while (store.dequeueMotion() !== null) {
      // キューを空にする
    }
  })

  describe('メッセージ履歴の制限', () => {
    it('100件を超えるメッセージは古いものから削除される', () => {
      const store = useAppStore.getState()

      // 110件のメッセージを追加
      for (let i = 0; i < 110; i++) {
        store.addMessage({
          id: `msg-${i}`,
          role: 'user',
          content: `メッセージ ${i}`,
          timestamp: i,
        })
      }

      // 100件に制限されていることを確認
      const state = useAppStore.getState()
      expect(state.messages.length).toBe(100)

      // 最初のメッセージがmsg-10であることを確認（0-9は削除）
      expect(state.messages[0].id).toBe('msg-10')
      expect(state.messages[99].id).toBe('msg-109')
    })
  })

  describe('設定の更新', () => {
    it('モデル設定が正しく更新される', () => {
      const store = useAppStore.getState()

      store.updateConfig({
        model: {
          currentModelId: '/models/new/new.model3.json',
        },
      })

      const state = useAppStore.getState()
      expect(state.config.model.currentModelId).toBe('/models/new/new.model3.json')
    })

    it('UI設定が正しく更新される', () => {
      const store = useAppStore.getState()

      store.updateConfig({
        ui: {
          theme: 'dark',
          fontSize: 18,
        },
      })

      const state = useAppStore.getState()
      expect(state.config.ui.theme).toBe('dark')
      expect(state.config.ui.fontSize).toBe(18)
    })
  })

  describe('モーションキュー', () => {
    it('モーションをキューに追加して取り出せる', () => {
      const store = useAppStore.getState()

      store.enqueueMotion('happy')
      store.enqueueMotion('bow')
      store.enqueueMotion('wave')

      expect(store.dequeueMotion()).toBe('happy')
      expect(store.dequeueMotion()).toBe('bow')
      expect(store.dequeueMotion()).toBe('wave')
      expect(store.dequeueMotion()).toBeNull()
    })
  })
})
