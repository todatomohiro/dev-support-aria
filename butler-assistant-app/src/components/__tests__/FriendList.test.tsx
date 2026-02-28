import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FriendList } from '../FriendList'
import type { FriendLink } from '@/types'

// UserCodeModal をモック
vi.mock('../UserCodeModal', () => ({
  UserCodeModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="user-code-modal">UserCodeModal</div> : null,
}))

// friendService をモック
const mockUnfriend = vi.fn()
vi.mock('@/services/friendService', () => ({
  friendService: {
    unfriend: (...args: unknown[]) => mockUnfriend(...args),
  },
}))

const mockFriends: FriendLink[] = [
  { friendUserId: 'u1', displayName: 'Alice', linkedAt: 1000 },
  { friendUserId: 'u2', displayName: 'Bob', linkedAt: 2000 },
  { friendUserId: 'u3', displayName: 'Charlie', linkedAt: 3000 },
]

describe('FriendList', () => {
  const defaultProps = {
    friends: mockFriends,
    onRefresh: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('フレンド一覧を表示する', () => {
    render(<FriendList {...defaultProps} />)

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Charlie')).toBeInTheDocument()
  })

  it('フレンド数をヘッダーに表示する', () => {
    render(<FriendList {...defaultProps} />)

    expect(screen.getByText('フレンド (3)')).toBeInTheDocument()
  })

  it('displayName 昇順でソートして表示する', () => {
    render(<FriendList {...defaultProps} />)

    const rows = screen.getAllByTestId(/^friend-row-/)
    expect(rows[0]).toHaveAttribute('data-testid', 'friend-row-u1') // Alice
    expect(rows[1]).toHaveAttribute('data-testid', 'friend-row-u2') // Bob
    expect(rows[2]).toHaveAttribute('data-testid', 'friend-row-u3') // Charlie
  })

  it('空の場合に空状態メッセージを表示する', () => {
    render(<FriendList {...defaultProps} friends={[]} />)

    expect(screen.getByText('フレンドがいません')).toBeInTheDocument()
  })

  it('ローディング中はスケルトンを表示する', () => {
    render(<FriendList {...defaultProps} friends={[]} isLoading={true} />)

    expect(screen.getByTestId('friend-list-loading')).toBeInTheDocument()
  })

  it('「追加」ボタンでユーザーコードモーダルを開く', () => {
    render(<FriendList {...defaultProps} />)

    expect(screen.queryByTestId('user-code-modal')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('add-friend-button'))
    expect(screen.getByTestId('user-code-modal')).toBeInTheDocument()
  })

  it('フレンド解除ボタンで確認後に unfriend が呼ばれる', async () => {
    mockUnfriend.mockResolvedValue(undefined)
    window.confirm = vi.fn().mockReturnValue(true)

    render(<FriendList {...defaultProps} />)

    fireEvent.click(screen.getByTestId('unfriend-u1'))

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledWith('このフレンドを解除しますか？')
      expect(mockUnfriend).toHaveBeenCalledWith('u1')
      expect(defaultProps.onRefresh).toHaveBeenCalled()
    })
  })

  it('確認ダイアログでキャンセルすると解除しない', () => {
    window.confirm = vi.fn().mockReturnValue(false)

    render(<FriendList {...defaultProps} />)

    fireEvent.click(screen.getByTestId('unfriend-u1'))

    expect(mockUnfriend).not.toHaveBeenCalled()
  })
})
