import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UserCodeModal } from '../UserCodeModal'

// friendService をモック
const mockGetCode = vi.fn()
const mockGenerateCode = vi.fn()
const mockLinkByCode = vi.fn()
vi.mock('@/services/friendService', () => ({
  friendService: {
    getCode: () => mockGetCode(),
    generateCode: () => mockGenerateCode(),
    linkByCode: (...args: unknown[]) => mockLinkByCode(...args),
  },
}))

// appStore をモック
vi.mock('@/stores/appStore', () => ({
  useAppStore: vi.fn((selector: (state: Record<string, unknown>) => unknown) =>
    selector({ config: { profile: { nickname: 'テストユーザー' } } })
  ),
}))

describe('UserCodeModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCode.mockResolvedValue({ code: 'MYCODE123' })
  })

  it('isOpen=false の場合は何も表示しない', () => {
    render(<UserCodeModal isOpen={false} onClose={vi.fn()} />)

    expect(screen.queryByTestId('user-code-panel')).not.toBeInTheDocument()
  })

  it('isOpen=true の場合にモーダルを表示する', async () => {
    render(<UserCodeModal {...defaultProps} />)

    expect(screen.getByTestId('user-code-panel')).toBeInTheDocument()
    expect(screen.getByText('フレンドを追加')).toBeInTheDocument()
  })

  it('閉じるボタンで onClose が呼ばれる', () => {
    render(<UserCodeModal {...defaultProps} />)

    fireEvent.click(screen.getByTestId('user-code-close-button'))
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('オーバーレイクリックで onClose が呼ばれる', () => {
    render(<UserCodeModal {...defaultProps} />)

    fireEvent.click(screen.getByTestId('user-code-overlay'))
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('既存のユーザーコードを表示する', async () => {
    render(<UserCodeModal {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('my-user-code')).toHaveTextContent('MYCODE123')
    })
  })

  it('コードが無い場合は生成する', async () => {
    mockGetCode.mockResolvedValue({ code: null })
    mockGenerateCode.mockResolvedValue({ code: 'NEWCODE456' })

    render(<UserCodeModal {...defaultProps} />)

    await waitFor(() => {
      expect(mockGenerateCode).toHaveBeenCalled()
      expect(screen.getByTestId('my-user-code')).toHaveTextContent('NEWCODE456')
    })
  })

  it('コピーボタンでクリップボードにコピーする', async () => {
    const mockWriteText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: { writeText: mockWriteText },
    })

    render(<UserCodeModal {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('my-user-code')).toHaveTextContent('MYCODE123')
    })

    fireEvent.click(screen.getByTestId('copy-code-button'))

    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledWith('MYCODE123')
      expect(screen.getByTestId('copy-code-button')).toHaveTextContent('コピー済み')
    })
  })

  it('空のコードでは追加ボタンが無効になる', () => {
    render(<UserCodeModal {...defaultProps} />)

    expect(screen.getByTestId('link-user-button')).toBeDisabled()
  })

  it('ユーザーコードを入力すると追加ボタンが有効になる', () => {
    render(<UserCodeModal {...defaultProps} />)

    fireEvent.change(screen.getByTestId('user-code-input'), { target: { value: 'WXYZ' } })

    expect(screen.getByTestId('link-user-button')).not.toBeDisabled()
  })

  it('フレンドリンク成功時に成功メッセージを表示する', async () => {
    mockLinkByCode.mockResolvedValue({ friendUserId: 'u2' })
    render(<UserCodeModal {...defaultProps} />)

    fireEvent.change(screen.getByTestId('user-code-input'), { target: { value: 'FRIEND_CODE' } })
    fireEvent.click(screen.getByTestId('link-user-button'))

    await waitFor(() => {
      expect(mockLinkByCode).toHaveBeenCalledWith('FRIEND_CODE', 'テストユーザー')
      expect(screen.getByText('フレンドを追加しました')).toBeInTheDocument()
    })
  })

  it('フレンドリンク失敗時にエラーを表示する', async () => {
    mockLinkByCode.mockRejectedValue(new Error('無効なコード'))
    render(<UserCodeModal {...defaultProps} />)

    fireEvent.change(screen.getByTestId('user-code-input'), { target: { value: 'INVALID' } })
    fireEvent.click(screen.getByTestId('link-user-button'))

    await waitFor(() => {
      expect(screen.getByText('フレンドの追加に失敗しました。コードを確認してください。')).toBeInTheDocument()
    })
  })

  it('コード取得失敗時にエラーを表示する', async () => {
    mockGetCode.mockRejectedValue(new Error('取得失敗'))

    render(<UserCodeModal {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByText('コードの取得に失敗しました')).toBeInTheDocument()
    })
  })
})
