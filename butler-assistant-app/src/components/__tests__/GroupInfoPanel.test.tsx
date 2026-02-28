import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { GroupInfoPanel } from '../GroupInfoPanel'
import { useGroupChatStore } from '@/stores/groupChatStore'

// groupService をモック
const mockGetMembers = vi.fn()
const mockLeaveGroup = vi.fn()
vi.mock('@/services/groupService', () => ({
  groupService: {
    getMembers: (...args: unknown[]) => mockGetMembers(...args),
    leaveGroup: (...args: unknown[]) => mockLeaveGroup(...args),
  },
}))

// AddMemberModal をモック
vi.mock('../AddMemberModal', () => ({
  AddMemberModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="add-member-modal">AddMemberModal</div> : null,
}))

describe('GroupInfoPanel', () => {
  const defaultProps = {
    groupId: 'g1',
    onClose: vi.fn(),
    onLeave: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useGroupChatStore.getState().reset()
    mockGetMembers.mockResolvedValue({
      members: [
        { userId: 'u1', nickname: 'User1' },
        { userId: 'u2', nickname: 'User2' },
      ],
      groupName: 'テストグループ',
    })
  })

  it('グループ情報パネルを表示する', () => {
    render(<GroupInfoPanel {...defaultProps} />)

    expect(screen.getByTestId('group-info-panel')).toBeInTheDocument()
    expect(screen.getByText('グループ情報')).toBeInTheDocument()
  })

  it('メンバー一覧を読み込んで表示する', async () => {
    render(<GroupInfoPanel {...defaultProps} />)

    await waitFor(() => {
      expect(mockGetMembers).toHaveBeenCalledWith('g1')
    })

    // ストアに設定されたメンバーを表示
    const members = useGroupChatStore.getState().activeMembers
    expect(members).toHaveLength(2)
    expect(members[0].nickname).toBe('User1')
  })

  it('閉じるボタンで onClose が呼ばれる', () => {
    render(<GroupInfoPanel {...defaultProps} />)

    // 閉じるボタンをクリック（×ボタン）
    const closeButton = screen.getByTestId('group-info-panel').querySelector('button')
    fireEvent.click(closeButton!)
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('グループ退出ボタンで確認ダイアログ後に退出する', async () => {
    mockLeaveGroup.mockResolvedValue(undefined)
    window.confirm = vi.fn().mockReturnValue(true)

    render(<GroupInfoPanel {...defaultProps} />)

    fireEvent.click(screen.getByTestId('leave-group-button'))

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledWith('このグループを退出しますか？')
      expect(mockLeaveGroup).toHaveBeenCalledWith('g1')
      expect(defaultProps.onLeave).toHaveBeenCalled()
    })
  })

  it('確認ダイアログでキャンセルすると退出しない', () => {
    window.confirm = vi.fn().mockReturnValue(false)

    render(<GroupInfoPanel {...defaultProps} />)

    fireEvent.click(screen.getByTestId('leave-group-button'))

    expect(mockLeaveGroup).not.toHaveBeenCalled()
    expect(defaultProps.onLeave).not.toHaveBeenCalled()
  })

  it('「追加」ボタンでメンバー追加モーダルを開く', () => {
    render(<GroupInfoPanel {...defaultProps} />)

    expect(screen.queryByTestId('add-member-modal')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('add-member-button'))
    expect(screen.getByTestId('add-member-modal')).toBeInTheDocument()
  })

  it('アンマウント時にメンバーをクリアする', () => {
    useGroupChatStore.getState().setActiveMembers([{ userId: 'u1', nickname: 'User1' }])

    const { unmount } = render(<GroupInfoPanel {...defaultProps} />)
    unmount()

    expect(useGroupChatStore.getState().activeMembers).toEqual([])
  })
})
