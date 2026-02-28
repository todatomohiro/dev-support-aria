import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConversationList } from '../ConversationList'
import type { ConversationSummary } from '@/types'

// FriendCodeModal をモック（子コンポーネント）
vi.mock('../FriendCodeModal', () => ({
  FriendCodeModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="friend-code-modal">FriendCodeModal</div> : null,
}))

describe('ConversationList', () => {
  const mockOnSelectConversation = vi.fn()
  const mockOnRefresh = vi.fn()

  const mockConversations: ConversationSummary[] = [
    { conversationId: 'conv_1', otherUserId: 'user-1', otherDisplayName: 'Alice', lastMessage: 'こんにちは！', updatedAt: 1700100000000 },
    { conversationId: 'conv_2', otherUserId: 'user-2', otherDisplayName: 'Bob', lastMessage: 'お元気ですか？', updatedAt: 1700000000000 },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('表示', () => {
    it('会話一覧が表示される', () => {
      render(
        <ConversationList
          conversations={mockConversations}
          onSelectConversation={mockOnSelectConversation}
          onRefresh={mockOnRefresh}
        />
      )

      expect(screen.getByTestId('conversation-list')).toBeInTheDocument()
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.getByText('Bob')).toBeInTheDocument()
    })

    it('最新メッセージが表示される', () => {
      render(
        <ConversationList
          conversations={mockConversations}
          onSelectConversation={mockOnSelectConversation}
          onRefresh={mockOnRefresh}
        />
      )

      expect(screen.getByText('こんにちは！')).toBeInTheDocument()
      expect(screen.getByText('お元気ですか？')).toBeInTheDocument()
    })

    it('updatedAt の降順でソートされる', () => {
      render(
        <ConversationList
          conversations={mockConversations}
          onSelectConversation={mockOnSelectConversation}
          onRefresh={mockOnRefresh}
        />
      )

      const rows = screen.getAllByTestId(/conversation-row-/)
      expect(rows[0]).toHaveAttribute('data-testid', 'conversation-row-conv_1')
      expect(rows[1]).toHaveAttribute('data-testid', 'conversation-row-conv_2')
    })

    it('ヘッダーに「チャット」と表示される', () => {
      render(
        <ConversationList
          conversations={mockConversations}
          onSelectConversation={mockOnSelectConversation}
          onRefresh={mockOnRefresh}
        />
      )

      expect(screen.getByText('チャット')).toBeInTheDocument()
    })

    it('イニシャルアバターが表示される', () => {
      render(
        <ConversationList
          conversations={mockConversations}
          onSelectConversation={mockOnSelectConversation}
          onRefresh={mockOnRefresh}
        />
      )

      expect(screen.getByText('A')).toBeInTheDocument()
      expect(screen.getByText('B')).toBeInTheDocument()
    })
  })

  describe('空の状態', () => {
    it('会話がない場合は空メッセージが表示される', () => {
      render(
        <ConversationList
          conversations={[]}
          onSelectConversation={mockOnSelectConversation}
          onRefresh={mockOnRefresh}
        />
      )

      expect(screen.getByText('まだ会話がありません')).toBeInTheDocument()
    })
  })

  describe('インタラクション', () => {
    it('会話をクリックすると onSelectConversation が呼ばれる', () => {
      render(
        <ConversationList
          conversations={mockConversations}
          onSelectConversation={mockOnSelectConversation}
          onRefresh={mockOnRefresh}
        />
      )

      fireEvent.click(screen.getByTestId('conversation-row-conv_1'))
      expect(mockOnSelectConversation).toHaveBeenCalledWith('conv_1')
    })

    it('フレンド追加ボタンをクリックするとモーダルが開く', () => {
      render(
        <ConversationList
          conversations={mockConversations}
          onSelectConversation={mockOnSelectConversation}
          onRefresh={mockOnRefresh}
        />
      )

      expect(screen.queryByTestId('friend-code-modal')).not.toBeInTheDocument()

      fireEvent.click(screen.getByTestId('add-friend-button'))

      expect(screen.getByTestId('friend-code-modal')).toBeInTheDocument()
    })
  })

  describe('ローディング状態', () => {
    it('ローディング中はスケルトン UI が表示される', () => {
      render(
        <ConversationList
          conversations={[]}
          onSelectConversation={mockOnSelectConversation}
          onRefresh={mockOnRefresh}
          isLoading={true}
        />
      )

      expect(screen.getByTestId('conversation-list-loading')).toBeInTheDocument()
    })

    it('会話がある場合はローディング中でもスケルトンを表示しない', () => {
      render(
        <ConversationList
          conversations={mockConversations}
          onSelectConversation={mockOnSelectConversation}
          onRefresh={mockOnRefresh}
          isLoading={true}
        />
      )

      expect(screen.queryByTestId('conversation-list-loading')).not.toBeInTheDocument()
      expect(screen.getByText('Alice')).toBeInTheDocument()
    })
  })

  describe('エラー状態', () => {
    it('エラー時にエラーメッセージが表示される', () => {
      render(
        <ConversationList
          conversations={[]}
          onSelectConversation={mockOnSelectConversation}
          onRefresh={mockOnRefresh}
          error="会話一覧の取得に失敗しました"
        />
      )

      expect(screen.getByTestId('conversation-list-error')).toBeInTheDocument()
      expect(screen.getByText('会話一覧の取得に失敗しました')).toBeInTheDocument()
    })

    it('再試行ボタンクリックで onRefresh が呼ばれる', () => {
      render(
        <ConversationList
          conversations={[]}
          onSelectConversation={mockOnSelectConversation}
          onRefresh={mockOnRefresh}
          error="エラー"
        />
      )

      fireEvent.click(screen.getByTestId('conversation-list-retry'))
      expect(mockOnRefresh).toHaveBeenCalled()
    })
  })

  describe('未読バッジ', () => {
    it('未読がある会話にバッジが表示される', () => {
      render(
        <ConversationList
          conversations={mockConversations}
          onSelectConversation={mockOnSelectConversation}
          onRefresh={mockOnRefresh}
          unreadCounts={{ conv_1: 3 }}
        />
      )

      expect(screen.getByTestId('unread-badge-conv_1')).toHaveTextContent('3')
    })

    it('未読がない会話にはバッジが表示されない', () => {
      render(
        <ConversationList
          conversations={mockConversations}
          onSelectConversation={mockOnSelectConversation}
          onRefresh={mockOnRefresh}
          unreadCounts={{}}
        />
      )

      expect(screen.queryByTestId('unread-badge-conv_1')).not.toBeInTheDocument()
      expect(screen.queryByTestId('unread-badge-conv_2')).not.toBeInTheDocument()
    })

    it('99を超える未読は「99+」と表示される', () => {
      render(
        <ConversationList
          conversations={mockConversations}
          onSelectConversation={mockOnSelectConversation}
          onRefresh={mockOnRefresh}
          unreadCounts={{ conv_1: 150 }}
        />
      )

      expect(screen.getByTestId('unread-badge-conv_1')).toHaveTextContent('99+')
    })
  })
})
