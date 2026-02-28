import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ConversationChat } from '../ConversationChat'
import { useMultiChatStore } from '@/stores/multiChatStore'
import type { ConversationMessage } from '@/types'

// conversationService をモック
const mockGetMessages = vi.fn().mockResolvedValue({ messages: [] })
const mockSendMessage = vi.fn()

vi.mock('@/services/conversationService', () => ({
  conversationService: {
    getMessages: (...args: unknown[]) => mockGetMessages(...args),
    sendMessage: (...args: unknown[]) => mockSendMessage(...args),
    listConversations: vi.fn().mockResolvedValue([]),
    pollNewMessages: vi.fn().mockResolvedValue([]),
  },
}))

// useConversationPolling をモック
vi.mock('@/hooks/useConversationPolling', () => ({
  useConversationPolling: vi.fn(),
}))

// useWebSocket をモック
vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: vi.fn(),
}))

// authStore をモック
vi.mock('@/auth/authStore', () => ({
  useAuthStore: vi.fn((selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      user: { userId: 'my-user-id', email: 'test@example.com', displayName: 'テストユーザー' },
      accessToken: 'test-token',
    })
  ),
}))

describe('ConversationChat', () => {
  const mockOnBack = vi.fn()

  const mockMessages: ConversationMessage[] = [
    { id: 'msg-1', senderId: 'other-user', senderName: 'Friend', content: 'こんにちは', timestamp: 1700000000000, type: 'text' },
    { id: 'msg-2', senderId: 'my-user-id', senderName: 'テストユーザー', content: 'やあ！', timestamp: 1700000001000, type: 'text' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    useMultiChatStore.getState().reset()
    mockGetMessages.mockResolvedValue({ messages: mockMessages })
    mockSendMessage.mockResolvedValue({
      id: 'msg-new', senderId: 'my-user-id', senderName: 'テストユーザー', content: 'テスト', timestamp: 1700000002000, type: 'text',
    })
  })

  describe('表示', () => {
    it('チャット画面が表示される', () => {
      render(<ConversationChat conversationId="conv_1" otherDisplayName="Friend" onBack={mockOnBack} />)
      expect(screen.getByTestId('conversation-chat')).toBeInTheDocument()
    })

    it('相手の名前がヘッダーに表示される', () => {
      render(<ConversationChat conversationId="conv_1" otherDisplayName="Friend" onBack={mockOnBack} />)
      // モバイルヘッダーとデスクトップヘッダーの両方に名前がある
      const names = screen.getAllByText('Friend')
      expect(names.length).toBeGreaterThanOrEqual(1)
    })

    it('戻るボタンが表示される', () => {
      render(<ConversationChat conversationId="conv_1" otherDisplayName="Friend" onBack={mockOnBack} />)
      expect(screen.getByTestId('chat-back-button')).toBeInTheDocument()
    })

    it('メッセージ入力欄が表示される', () => {
      render(<ConversationChat conversationId="conv_1" otherDisplayName="Friend" onBack={mockOnBack} />)
      expect(screen.getByTestId('multi-chat-input')).toBeInTheDocument()
    })

    it('送信ボタンが表示される', () => {
      render(<ConversationChat conversationId="conv_1" otherDisplayName="Friend" onBack={mockOnBack} />)
      expect(screen.getByTestId('multi-chat-send-button')).toBeInTheDocument()
    })
  })

  describe('メッセージ読み込み', () => {
    it('マウント時にメッセージを読み込む', async () => {
      render(<ConversationChat conversationId="conv_1" otherDisplayName="Friend" onBack={mockOnBack} />)

      await waitFor(() => {
        expect(mockGetMessages).toHaveBeenCalledWith('conv_1')
      })
    })

    it('読み込んだメッセージが表示される', async () => {
      render(<ConversationChat conversationId="conv_1" otherDisplayName="Friend" onBack={mockOnBack} />)

      await waitFor(() => {
        expect(screen.getByText('こんにちは')).toBeInTheDocument()
        expect(screen.getByText('やあ！')).toBeInTheDocument()
      })
    })
  })

  describe('インタラクション', () => {
    it('戻るボタンクリックで onBack が呼ばれる', () => {
      render(<ConversationChat conversationId="conv_1" otherDisplayName="Friend" onBack={mockOnBack} />)
      fireEvent.click(screen.getByTestId('chat-back-button'))
      expect(mockOnBack).toHaveBeenCalled()
    })

    it('テキスト入力が反映される', () => {
      render(<ConversationChat conversationId="conv_1" otherDisplayName="Friend" onBack={mockOnBack} />)

      const input = screen.getByTestId('multi-chat-input')
      fireEvent.change(input, { target: { value: 'テストメッセージ' } })
      expect(input).toHaveValue('テストメッセージ')
    })

    it('空テキストでは送信ボタンが無効', () => {
      render(<ConversationChat conversationId="conv_1" otherDisplayName="Friend" onBack={mockOnBack} />)
      expect(screen.getByTestId('multi-chat-send-button')).toBeDisabled()
    })

    it('送信ボタンクリックでメッセージを送信する', async () => {
      render(<ConversationChat conversationId="conv_1" otherDisplayName="Friend" onBack={mockOnBack} />)

      const input = screen.getByTestId('multi-chat-input')
      fireEvent.change(input, { target: { value: 'テストメッセージ' } })

      const sendButton = screen.getByTestId('multi-chat-send-button')
      fireEvent.click(sendButton)

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith('conv_1', 'テストメッセージ', 'テストユーザー')
      })
    })

    it('送信後に入力欄がクリアされる', async () => {
      render(<ConversationChat conversationId="conv_1" otherDisplayName="Friend" onBack={mockOnBack} />)

      const input = screen.getByTestId('multi-chat-input')
      fireEvent.change(input, { target: { value: 'テスト' } })

      const sendButton = screen.getByTestId('multi-chat-send-button')
      fireEvent.click(sendButton)

      await waitFor(() => {
        expect(input).toHaveValue('')
      })
    })
  })

  describe('ローディング/エラー状態', () => {
    it('メッセージ読み込みエラー時にエラーメッセージが表示される', async () => {
      mockGetMessages.mockRejectedValueOnce(new Error('Network error'))

      render(<ConversationChat conversationId="conv_1" otherDisplayName="Friend" onBack={mockOnBack} />)

      await waitFor(() => {
        expect(screen.getByTestId('messages-error')).toBeInTheDocument()
        expect(screen.getByText('メッセージの読み込みに失敗しました')).toBeInTheDocument()
      })
    })

    it('再試行ボタンクリックでメッセージを再読み込みする', async () => {
      mockGetMessages.mockRejectedValueOnce(new Error('Network error'))

      render(<ConversationChat conversationId="conv_1" otherDisplayName="Friend" onBack={mockOnBack} />)

      await waitFor(() => {
        expect(screen.getByTestId('messages-retry')).toBeInTheDocument()
      })

      mockGetMessages.mockResolvedValueOnce({ messages: mockMessages })
      fireEvent.click(screen.getByTestId('messages-retry'))

      await waitFor(() => {
        expect(mockGetMessages).toHaveBeenCalledTimes(2)
      })
    })
  })

  describe('日付セパレータ', () => {
    it('メッセージ間で日付が変わると日付セパレータが表示される', async () => {
      const crossDayMessages: ConversationMessage[] = [
        { id: 'msg-1', senderId: 'other-user', senderName: 'Friend', content: '昨日のメッセージ', timestamp: new Date(2026, 1, 27, 20, 0).getTime(), type: 'text' },
        { id: 'msg-2', senderId: 'my-user-id', senderName: 'Me', content: '今日のメッセージ', timestamp: new Date(2026, 1, 28, 10, 0).getTime(), type: 'text' },
      ]
      mockGetMessages.mockResolvedValueOnce({ messages: crossDayMessages })

      render(<ConversationChat conversationId="conv_1" otherDisplayName="Friend" onBack={mockOnBack} />)

      await waitFor(() => {
        const separators = screen.getAllByTestId('date-separator')
        expect(separators.length).toBe(2) // 最初のメッセージの前 + 日付変更時
      })
    })

    it('同日のメッセージ間にはセパレータが表示されない', async () => {
      mockGetMessages.mockResolvedValueOnce({ messages: mockMessages })

      render(<ConversationChat conversationId="conv_1" otherDisplayName="Friend" onBack={mockOnBack} />)

      await waitFor(() => {
        const separators = screen.getAllByTestId('date-separator')
        // 同日のメッセージなので最初の1つだけ
        expect(separators.length).toBe(1)
      })
    })
  })

  describe('モバイルヘッダー', () => {
    it('モバイルヘッダーにアバターと名前が表示される', () => {
      render(<ConversationChat conversationId="conv_1" otherDisplayName="Friend" onBack={mockOnBack} />)

      const mobileHeader = screen.getByTestId('mobile-header-info')
      expect(mobileHeader).toBeInTheDocument()
      expect(mobileHeader).toHaveTextContent('F') // イニシャル
      expect(mobileHeader).toHaveTextContent('Friend')
    })
  })

  describe('WebSocket フォールバック', () => {
    it('wsStatus が failed の場合はポーリングが有効になる', async () => {
      const { useConversationPolling } = await import('@/hooks/useConversationPolling')
      const mockUseConversationPolling = vi.mocked(useConversationPolling)

      // wsStatus を failed に設定
      useMultiChatStore.getState().setWsStatus('failed')

      render(<ConversationChat conversationId="conv_1" otherDisplayName="Friend" onBack={mockOnBack} />)

      // wsStatus === 'failed' なので conversationId が渡される
      expect(mockUseConversationPolling).toHaveBeenCalledWith('conv_1')
    })

    it('wsStatus が open の場合はポーリングに null が渡される', async () => {
      const { useConversationPolling } = await import('@/hooks/useConversationPolling')
      const mockUseConversationPolling = vi.mocked(useConversationPolling)

      // wsStatus を open に設定
      useMultiChatStore.getState().setWsStatus('open')

      render(<ConversationChat conversationId="conv_1" otherDisplayName="Friend" onBack={mockOnBack} />)

      // wsStatus !== 'failed' なので null が渡される
      expect(mockUseConversationPolling).toHaveBeenCalledWith(null)
    })
  })
})
