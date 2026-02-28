import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AddMemberModal } from '../AddMemberModal'

// groupService をモック
const mockAddMember = vi.fn()
vi.mock('@/services/groupService', () => ({
  groupService: {
    addMember: (...args: unknown[]) => mockAddMember(...args),
  },
}))

// friendService をモック
const mockListFriends = vi.fn()
vi.mock('@/services/friendService', () => ({
  friendService: {
    listFriends: () => mockListFriends(),
  },
}))

describe('AddMemberModal', () => {
  const defaultProps = {
    isOpen: true,
    groupId: 'g1',
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockListFriends.mockResolvedValue([
      { friendUserId: 'u1', displayName: 'Friend1', linkedAt: 1000 },
      { friendUserId: 'u2', displayName: 'Friend2', linkedAt: 2000 },
    ])
  })

  it('isOpen=false の場合は何も表示しない', () => {
    render(<AddMemberModal isOpen={false} groupId="g1" onClose={vi.fn()} />)

    expect(screen.queryByTestId('add-member-panel')).not.toBeInTheDocument()
  })

  it('isOpen=true の場合にモーダルを表示する', async () => {
    render(<AddMemberModal {...defaultProps} />)

    expect(screen.getByTestId('add-member-panel')).toBeInTheDocument()
    expect(screen.getByText('メンバーを追加')).toBeInTheDocument()
  })

  it('閉じるボタンで onClose が呼ばれる', () => {
    render(<AddMemberModal {...defaultProps} />)

    fireEvent.click(screen.getByTestId('add-member-close-button'))
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('オーバーレイクリックで onClose が呼ばれる', () => {
    render(<AddMemberModal {...defaultProps} />)

    fireEvent.click(screen.getByTestId('add-member-overlay'))
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('フレンド一覧を表示する', async () => {
    render(<AddMemberModal {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByText('Friend1')).toBeInTheDocument()
      expect(screen.getByText('Friend2')).toBeInTheDocument()
    })
  })

  it('フレンドをクリックして addMember(userId) が呼ばれる', async () => {
    mockAddMember.mockResolvedValue({ userId: 'u1', nickname: 'Friend1' })
    render(<AddMemberModal {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('add-friend-u1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('add-friend-u1'))

    await waitFor(() => {
      expect(mockAddMember).toHaveBeenCalledWith('g1', { userId: 'u1' })
    })
  })

  it('ユーザーコードでメンバーを追加する', async () => {
    mockAddMember.mockResolvedValue({ userId: 'u3', nickname: 'User3' })
    render(<AddMemberModal {...defaultProps} />)

    fireEvent.change(screen.getByTestId('user-code-input'), { target: { value: 'ABCD1234' } })
    fireEvent.click(screen.getByTestId('add-by-code-button'))

    await waitFor(() => {
      expect(mockAddMember).toHaveBeenCalledWith('g1', { userCode: 'ABCD1234' })
    })
  })

  it('空のコードでは追加ボタンが無効になる', () => {
    render(<AddMemberModal {...defaultProps} />)

    expect(screen.getByTestId('add-by-code-button')).toBeDisabled()
  })

  it('メンバー追加成功時に成功メッセージを表示する', async () => {
    mockAddMember.mockResolvedValue({ userId: 'u3', nickname: 'User3' })
    render(<AddMemberModal {...defaultProps} />)

    fireEvent.change(screen.getByTestId('user-code-input'), { target: { value: 'CODE' } })
    fireEvent.click(screen.getByTestId('add-by-code-button'))

    await waitFor(() => {
      expect(screen.getByText('User3 を追加しました')).toBeInTheDocument()
    })
  })

  it('メンバー追加失敗時にエラーを表示する', async () => {
    mockAddMember.mockRejectedValue(new Error('追加失敗'))
    render(<AddMemberModal {...defaultProps} />)

    fireEvent.change(screen.getByTestId('user-code-input'), { target: { value: 'INVALID' } })
    fireEvent.click(screen.getByTestId('add-by-code-button'))

    await waitFor(() => {
      expect(screen.getByText('メンバーの追加に失敗しました。コードを確認してください。')).toBeInTheDocument()
    })
  })

  it('フレンドがいない場合はフレンドセクションを表示しない', async () => {
    mockListFriends.mockResolvedValue([])
    render(<AddMemberModal {...defaultProps} />)

    await waitFor(() => {
      expect(screen.queryByText('フレンドから追加')).not.toBeInTheDocument()
    })
  })
})
