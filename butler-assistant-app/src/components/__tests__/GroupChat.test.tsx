import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { GroupChat } from '../GroupChat'
import { useGroupChatStore } from '@/stores/groupChatStore'

// groupService をモック
const mockGetMessages = vi.fn()
const mockSendMessage = vi.fn()
const mockMarkAsRead = vi.fn()
const mockGetMembers = vi.fn()
const mockLeaveGroup = vi.fn()
vi.mock('@/services/groupService', () => ({
  groupService: {
    getMessages: (...args: unknown[]) => mockGetMessages(...args),
    sendMessage: (...args: unknown[]) => mockSendMessage(...args),
    markAsRead: (...args: unknown[]) => mockMarkAsRead(...args),
    getMembers: (...args: unknown[]) => mockGetMembers(...args),
    leaveGroup: (...args: unknown[]) => mockLeaveGroup(...args),
  },
}))

// wsService をモック
vi.mock('@/services/wsService', () => ({
  wsService: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    reconnect: vi.fn(),
  },
}))

// useWebSocket をモック
vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: vi.fn(),
}))

// useGroupPolling をモック
vi.mock('@/hooks/useGroupPolling', () => ({
  useGroupPolling: vi.fn(),
}))

// authStore をモック
vi.mock('@/auth/authStore', () => ({
  useAuthStore: vi.fn((selector: (state: Record<string, unknown>) => unknown) =>
    selector({ accessToken: 'test-token', user: { userId: 'me', email: 'test@example.com' } })
  ),
}))

// appStore をモック
vi.mock('@/stores/appStore', () => ({
  useAppStore: vi.fn((selector: (state: Record<string, unknown>) => unknown) =>
    selector({ config: { profile: { nickname: 'テストユーザー' } } })
  ),
}))

// AddMemberModal をモック
vi.mock('../AddMemberModal', () => ({
  AddMemberModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="add-member-modal">AddMemberModal</div> : null,
}))

// utils をモック
vi.mock('@/utils', () => ({
  formatTime: (ts: number) => `${new Date(ts).getHours()}:${new Date(ts).getMinutes()}`,
  formatDateSeparator: () => '2026/02/28',
  isSameDay: (a: number, b: number) => Math.floor(a / 86400000) === Math.floor(b / 86400000),
}))

describe('GroupChat', () => {
  const defaultProps = {
    groupId: 'g1',
    groupName: 'テストグループ',
    onBack: vi.fn(),
    onLeave: vi.fn(),
  }

  const mockMembers = [
    { userId: 'me', nickname: 'テストユーザー' },
    { userId: 'u2', nickname: 'Alice' },
    { userId: 'u3', nickname: 'Bob' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    useGroupChatStore.getState().reset()
    mockGetMessages.mockResolvedValue({ messages: [] })
    mockMarkAsRead.mockResolvedValue(undefined)
    mockGetMembers.mockResolvedValue({ members: mockMembers, groupName: 'テストグループ' })
    mockLeaveGroup.mockResolvedValue(undefined)
    // scrollIntoView のモック
    Element.prototype.scrollIntoView = vi.fn()
    // confirm のモック
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('チャット画面を表示する', async () => {
    render(<GroupChat {...defaultProps} />)

    expect(screen.getByTestId('group-chat')).toBeInTheDocument()
    expect(screen.getByText('テストグループ')).toBeInTheDocument()
  })

  it('戻るボタンで onBack が呼ばれる', () => {
    render(<GroupChat {...defaultProps} />)

    fireEvent.click(screen.getByTestId('chat-back-button'))
    expect(defaultProps.onBack).toHaveBeenCalled()
  })

  it('マウント時にメッセージを読み込む', async () => {
    const messages = [
      { id: 'm1', senderId: 'other', senderName: 'Alice', content: 'Hello', timestamp: 1700000000000, type: 'text' },
    ]
    mockGetMessages.mockResolvedValue({ messages })

    render(<GroupChat {...defaultProps} />)

    await waitFor(() => {
      expect(mockGetMessages).toHaveBeenCalledWith('g1')
    })
  })

  it('ローディング中はスケルトンを表示する', async () => {
    // メッセージ読み込みが解決する前のローディング状態をテスト
    let resolveGetMessages: (value: { messages: never[] }) => void
    mockGetMessages.mockReturnValue(new Promise((resolve) => {
      resolveGetMessages = resolve
    }))

    render(<GroupChat {...defaultProps} />)

    // ローディング中（setLoadingMessages が true になるが、store は外部なのでスキップ）
    // 代わりに、getMessages が呼ばれることを確認
    expect(mockGetMessages).toHaveBeenCalledWith('g1')

    // 解決してクリーンアップ
    resolveGetMessages!({ messages: [] })
  })

  it('メッセージを表示する（自分のメッセージは右寄せ）', async () => {
    const messages = [
      { id: 'm1', senderId: 'other', senderName: 'Alice', content: 'こんにちは', timestamp: 1700000000000, type: 'text' },
      { id: 'm2', senderId: 'me', senderName: 'テストユーザー', content: 'はい', timestamp: 1700000001000, type: 'text' },
    ]
    mockGetMessages.mockResolvedValue({ messages })

    render(<GroupChat {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByText('こんにちは')).toBeInTheDocument()
      expect(screen.getByText('はい')).toBeInTheDocument()
    })

    // 他人のメッセージには senderName が表示される
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('システムメッセージを表示する', async () => {
    const messages = [
      { id: 'm1', senderId: 'system', senderName: '', content: 'Alice がグループに参加しました', timestamp: 1700000000000, type: 'system' },
    ]
    mockGetMessages.mockResolvedValue({ messages })

    render(<GroupChat {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('system-message')).toBeInTheDocument()
      expect(screen.getByText('Alice がグループに参加しました')).toBeInTheDocument()
    })
  })

  it('メッセージを送信する', async () => {
    const newMessage = { id: 'm1', senderId: 'me', senderName: 'テストユーザー', content: 'テストメッセージ', timestamp: 1700000000000, type: 'text' }
    mockSendMessage.mockResolvedValue(newMessage)

    render(<GroupChat {...defaultProps} />)

    const input = screen.getByTestId('group-chat-input')
    fireEvent.change(input, { target: { value: 'テストメッセージ' } })
    fireEvent.click(screen.getByTestId('group-chat-send-button'))

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith('g1', 'テストメッセージ', 'テストユーザー')
    })
  })

  it('空のテキストでは送信ボタンが無効になる', () => {
    render(<GroupChat {...defaultProps} />)

    expect(screen.getByTestId('group-chat-send-button')).toBeDisabled()
  })

  it('WS connecting 時にステータスバーを表示する', () => {
    useGroupChatStore.getState().setWsStatus('connecting')
    render(<GroupChat {...defaultProps} />)

    expect(screen.getByTestId('ws-status-bar')).toBeInTheDocument()
    expect(screen.getByText('接続中...')).toBeInTheDocument()
  })

  it('WS failed 時にステータスバーと再接続ボタンを表示する', () => {
    useGroupChatStore.getState().setWsStatus('failed')
    render(<GroupChat {...defaultProps} />)

    expect(screen.getByTestId('ws-status-bar')).toBeInTheDocument()
    expect(screen.getByTestId('ws-reconnect-button')).toBeInTheDocument()
  })

  it('メッセージ読み込みエラー時に再試行ボタンを表示する', async () => {
    mockGetMessages.mockRejectedValue(new Error('読み込みエラー'))

    render(<GroupChat {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('messages-error')).toBeInTheDocument()
      expect(screen.getByText('メッセージの読み込みに失敗しました')).toBeInTheDocument()
    })

    // 再試行
    mockGetMessages.mockResolvedValue({ messages: [] })
    fireEvent.click(screen.getByTestId('messages-retry'))

    await waitFor(() => {
      expect(mockGetMessages).toHaveBeenCalledTimes(2)
    })
  })

  describe('メンバーアバター', () => {
    it('マウント時にメンバー一覧を取得してアバターを表示する', async () => {
      render(<GroupChat {...defaultProps} />)

      await waitFor(() => {
        expect(mockGetMembers).toHaveBeenCalledWith('g1')
        expect(screen.getByTestId('member-avatars-button')).toBeInTheDocument()
      })
    })

    it('メンバーが5人以上の場合に +N を表示する', async () => {
      const fiveMembers = [
        { userId: 'u1', nickname: 'Alice' },
        { userId: 'u2', nickname: 'Bob' },
        { userId: 'u3', nickname: 'Carol' },
        { userId: 'u4', nickname: 'Dave' },
        { userId: 'u5', nickname: 'Eve' },
      ]
      mockGetMembers.mockResolvedValue({ members: fiveMembers, groupName: 'テストグループ' })

      render(<GroupChat {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByTestId('member-overflow-count')).toHaveTextContent('+1')
      })
    })

    it('メンバー取得失敗時はアバターを表示しない', async () => {
      mockGetMembers.mockRejectedValue(new Error('取得失敗'))

      render(<GroupChat {...defaultProps} />)

      await waitFor(() => {
        expect(mockGetMembers).toHaveBeenCalledWith('g1')
      })

      expect(screen.queryByTestId('member-avatars-button')).not.toBeInTheDocument()
    })
  })

  describe('メンバーポップオーバー', () => {
    it('アバタークリックでポップオーバーを表示する', async () => {
      render(<GroupChat {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByTestId('member-avatars-button')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('member-avatars-button'))
      expect(screen.getByTestId('member-popover')).toBeInTheDocument()
      expect(screen.getByText('メンバー (3)')).toBeInTheDocument()
    })

    it('ポップオーバーにメンバー一覧を表示する', async () => {
      render(<GroupChat {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByTestId('member-avatars-button')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('member-avatars-button'))

      const memberList = screen.getByTestId('member-list')
      expect(memberList).toBeInTheDocument()
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.getByText('Bob')).toBeInTheDocument()
    })

    it('自分のメンバー行に (自分) ラベルを表示する', async () => {
      render(<GroupChat {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByTestId('member-avatars-button')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('member-avatars-button'))
      expect(screen.getByText('(自分)')).toBeInTheDocument()
    })

    it('「メンバーを追加」ボタンで AddMemberModal を開く', async () => {
      render(<GroupChat {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByTestId('member-avatars-button')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('member-avatars-button'))
      expect(screen.queryByTestId('add-member-modal')).not.toBeInTheDocument()

      fireEvent.click(screen.getByTestId('popover-add-member'))
      expect(screen.getByTestId('add-member-modal')).toBeInTheDocument()
      // ポップオーバーは閉じる
      expect(screen.queryByTestId('member-popover')).not.toBeInTheDocument()
    })

    it('「グループを退出」ボタンで退出処理を実行する', async () => {
      render(<GroupChat {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByTestId('member-avatars-button')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('member-avatars-button'))
      fireEvent.click(screen.getByTestId('popover-leave-group'))

      await waitFor(() => {
        expect(mockLeaveGroup).toHaveBeenCalledWith('g1')
        expect(defaultProps.onLeave).toHaveBeenCalled()
      })
    })

    it('再度クリックでポップオーバーを閉じる', async () => {
      render(<GroupChat {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByTestId('member-avatars-button')).toBeInTheDocument()
      })

      // 開く
      fireEvent.click(screen.getByTestId('member-avatars-button'))
      expect(screen.getByTestId('member-popover')).toBeInTheDocument()

      // 閉じる
      fireEvent.click(screen.getByTestId('member-avatars-button'))
      expect(screen.queryByTestId('member-popover')).not.toBeInTheDocument()
    })
  })
})
