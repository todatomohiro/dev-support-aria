import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CreateGroupModal } from '../CreateGroupModal'

// groupService をモック
const mockCreateGroup = vi.fn()
vi.mock('@/services/groupService', () => ({
  groupService: {
    createGroup: (...args: unknown[]) => mockCreateGroup(...args),
  },
}))

describe('CreateGroupModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('isOpen=false の場合は何も表示しない', () => {
    render(<CreateGroupModal isOpen={false} onClose={vi.fn()} />)

    expect(screen.queryByTestId('create-group-panel')).not.toBeInTheDocument()
  })

  it('isOpen=true の場合にモーダルを表示する', () => {
    render(<CreateGroupModal {...defaultProps} />)

    expect(screen.getByTestId('create-group-panel')).toBeInTheDocument()
    expect(screen.getByText('グループを作成')).toBeInTheDocument()
  })

  it('閉じるボタンで onClose が呼ばれる', () => {
    render(<CreateGroupModal {...defaultProps} />)

    fireEvent.click(screen.getByTestId('create-group-close-button'))
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('オーバーレイクリックで onClose が呼ばれる', () => {
    render(<CreateGroupModal {...defaultProps} />)

    fireEvent.click(screen.getByTestId('create-group-overlay'))
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('空のグループ名では作成ボタンが無効になる', () => {
    render(<CreateGroupModal {...defaultProps} />)

    expect(screen.getByTestId('create-group-submit')).toBeDisabled()
  })

  it('グループ名を入力すると作成ボタンが有効になる', () => {
    render(<CreateGroupModal {...defaultProps} />)

    fireEvent.change(screen.getByTestId('group-name-input'), { target: { value: 'テストグループ' } })

    expect(screen.getByTestId('create-group-submit')).not.toBeDisabled()
  })

  it('グループ作成成功時に onClose(true) が呼ばれる', async () => {
    mockCreateGroup.mockResolvedValue({ groupId: 'g1', groupName: 'テストグループ' })
    render(<CreateGroupModal {...defaultProps} />)

    fireEvent.change(screen.getByTestId('group-name-input'), { target: { value: 'テストグループ' } })
    fireEvent.click(screen.getByTestId('create-group-submit'))

    await waitFor(() => {
      expect(mockCreateGroup).toHaveBeenCalledWith('テストグループ')
      expect(defaultProps.onClose).toHaveBeenCalledWith(true)
    })
  })

  it('グループ作成失敗時にエラーを表示する', async () => {
    mockCreateGroup.mockRejectedValue(new Error('作成失敗'))
    render(<CreateGroupModal {...defaultProps} />)

    fireEvent.change(screen.getByTestId('group-name-input'), { target: { value: 'テスト' } })
    fireEvent.click(screen.getByTestId('create-group-submit'))

    await waitFor(() => {
      expect(screen.getByText('グループの作成に失敗しました')).toBeInTheDocument()
    })
  })
})
