import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GroupList } from '../GroupList'
import type { GroupSummary } from '@/types'

// UserCodeModal と CreateGroupModal をモック
vi.mock('../UserCodeModal', () => ({
  UserCodeModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="user-code-modal">UserCodeModal</div> : null,
}))
vi.mock('../CreateGroupModal', () => ({
  CreateGroupModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="create-group-modal">CreateGroupModal</div> : null,
}))

// utils をモック
vi.mock('@/utils', () => ({
  formatRelativeTimestamp: (ts: number) => `${ts}`,
}))

const mockGroups: GroupSummary[] = [
  { groupId: 'g1', groupName: 'テストグループ1', lastMessage: 'こんにちは', updatedAt: 2000 },
  { groupId: 'g2', groupName: 'テストグループ2', lastMessage: 'おはよう', updatedAt: 3000 },
  { groupId: 'g3', groupName: 'テストグループ3', lastMessage: 'さようなら', updatedAt: 1000 },
]

describe('GroupList', () => {
  const defaultProps = {
    groups: mockGroups,
    onSelectGroup: vi.fn(),
    onRefresh: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('グループ一覧を表示する', () => {
    render(<GroupList {...defaultProps} />)

    expect(screen.getByText('テストグループ1')).toBeInTheDocument()
    expect(screen.getByText('テストグループ2')).toBeInTheDocument()
    expect(screen.getByText('テストグループ3')).toBeInTheDocument()
  })

  it('updatedAt 降順でソートして表示する', () => {
    render(<GroupList {...defaultProps} />)

    const rows = screen.getAllByTestId(/^group-row-/)
    expect(rows[0]).toHaveAttribute('data-testid', 'group-row-g2')
    expect(rows[1]).toHaveAttribute('data-testid', 'group-row-g1')
    expect(rows[2]).toHaveAttribute('data-testid', 'group-row-g3')
  })

  it('最新メッセージを表示する', () => {
    render(<GroupList {...defaultProps} />)

    expect(screen.getByText('こんにちは')).toBeInTheDocument()
    expect(screen.getByText('おはよう')).toBeInTheDocument()
  })

  it('グループをクリックすると onSelectGroup が呼ばれる', () => {
    render(<GroupList {...defaultProps} />)

    fireEvent.click(screen.getByTestId('group-row-g1'))
    expect(defaultProps.onSelectGroup).toHaveBeenCalledWith('g1')
  })

  it('空の場合に空状態メッセージを表示する', () => {
    render(<GroupList {...defaultProps} groups={[]} />)

    expect(screen.getByText('まだグループがありません')).toBeInTheDocument()
  })

  it('ローディング中はスケルトンを表示する', () => {
    render(<GroupList {...defaultProps} groups={[]} isLoading={true} />)

    expect(screen.getByTestId('group-list-loading')).toBeInTheDocument()
  })

  it('エラー時はエラーメッセージを表示する', () => {
    render(<GroupList {...defaultProps} groups={[]} error="取得エラー" />)

    expect(screen.getByTestId('group-list-error')).toBeInTheDocument()
    expect(screen.getByText('取得エラー')).toBeInTheDocument()
  })

  it('エラー時の再試行ボタンで onRefresh が呼ばれる', () => {
    render(<GroupList {...defaultProps} groups={[]} error="取得エラー" />)

    fireEvent.click(screen.getByTestId('group-list-retry'))
    expect(defaultProps.onRefresh).toHaveBeenCalled()
  })

  describe('未読バッジ', () => {
    it('未読カウントを表示する', () => {
      render(<GroupList {...defaultProps} unreadCounts={{ g1: 5 }} />)

      expect(screen.getByTestId('unread-badge-g1')).toHaveTextContent('5')
    })

    it('100 以上の未読を 99+ と表示する', () => {
      render(<GroupList {...defaultProps} unreadCounts={{ g1: 150 }} />)

      expect(screen.getByTestId('unread-badge-g1')).toHaveTextContent('99+')
    })

    it('未読がないグループにはバッジを表示しない', () => {
      render(<GroupList {...defaultProps} unreadCounts={{}} />)

      expect(screen.queryByTestId('unread-badge-g1')).not.toBeInTheDocument()
    })
  })

  describe('WS ステータスインジケーター', () => {
    it('wsStatus が指定された場合にインジケーターを表示する', () => {
      render(<GroupList {...defaultProps} wsStatus="open" />)

      expect(screen.getByTestId('ws-status-indicator')).toBeInTheDocument()
    })

    it('failed 時にエラーテキストを表示する', () => {
      render(<GroupList {...defaultProps} wsStatus="failed" />)

      expect(screen.getByText('接続エラー')).toBeInTheDocument()
    })
  })

  describe('ニックネーム表示', () => {
    it('ニックネームを表示する', () => {
      render(<GroupList {...defaultProps} nickname="テストユーザー" />)

      expect(screen.getByTestId('group-chat-nickname')).toHaveTextContent('テストユーザー')
    })

    it('ニックネーム未設定時は「ゲスト」を表示する', () => {
      render(<GroupList {...defaultProps} />)

      expect(screen.getByTestId('group-chat-nickname')).toHaveTextContent('ゲスト')
    })
  })

  describe('モーダル', () => {
    it('「フレンド追加」ボタンでユーザーコードモーダルを開く', () => {
      render(<GroupList {...defaultProps} />)

      expect(screen.queryByTestId('user-code-modal')).not.toBeInTheDocument()

      fireEvent.click(screen.getByTestId('add-friend-button'))
      expect(screen.getByTestId('user-code-modal')).toBeInTheDocument()
    })

    it('「グループを作成」ボタンでグループ作成モーダルを開く', () => {
      render(<GroupList {...defaultProps} />)

      expect(screen.queryByTestId('create-group-modal')).not.toBeInTheDocument()

      fireEvent.click(screen.getByTestId('create-group-button'))
      expect(screen.getByTestId('create-group-modal')).toBeInTheDocument()
    })
  })
})
