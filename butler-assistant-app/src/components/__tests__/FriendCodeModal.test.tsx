import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FriendCodeModal } from '../FriendCodeModal'

// friendService をモック
const mockGenerateCode = vi.fn().mockResolvedValue({ code: 'ABCD1234' })
const mockGetCode = vi.fn().mockResolvedValue({ code: null })
const mockLinkByCode = vi.fn().mockResolvedValue({ conversationId: 'conv_1', friendUserId: 'user-2' })

vi.mock('@/services/friendService', () => ({
  friendService: {
    generateCode: (...args: unknown[]) => mockGenerateCode(...args),
    getCode: (...args: unknown[]) => mockGetCode(...args),
    linkByCode: (...args: unknown[]) => mockLinkByCode(...args),
    listFriends: vi.fn().mockResolvedValue([]),
  },
}))

// appStore をモック
vi.mock('@/stores/appStore', () => ({
  useAppStore: vi.fn((selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      config: {
        profile: { nickname: 'テストユーザー' },
      },
    })
  ),
}))

describe('FriendCodeModal', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCode.mockResolvedValue({ code: null })
    mockGenerateCode.mockResolvedValue({ code: 'ABCD1234' })
  })

  describe('表示制御', () => {
    it('isOpen が false の場合は何も表示されない', () => {
      render(<FriendCodeModal isOpen={false} onClose={mockOnClose} />)
      expect(screen.queryByTestId('friend-code-panel')).not.toBeInTheDocument()
    })

    it('isOpen が true の場合はパネルが表示される', () => {
      render(<FriendCodeModal isOpen={true} onClose={mockOnClose} />)
      expect(screen.getByTestId('friend-code-panel')).toBeInTheDocument()
    })

    it('ヘッダータイトルが「フレンドを追加」と表示される', () => {
      render(<FriendCodeModal isOpen={true} onClose={mockOnClose} />)
      expect(screen.getByText('フレンドを追加')).toBeInTheDocument()
    })
  })

  describe('閉じる操作', () => {
    it('閉じるボタンで onClose が呼ばれる', () => {
      render(<FriendCodeModal isOpen={true} onClose={mockOnClose} />)
      fireEvent.click(screen.getByTestId('friend-code-close-button'))
      expect(mockOnClose).toHaveBeenCalled()
    })

    it('オーバーレイクリックで onClose が呼ばれる', () => {
      render(<FriendCodeModal isOpen={true} onClose={mockOnClose} />)
      fireEvent.click(screen.getByTestId('friend-code-overlay'))
      expect(mockOnClose).toHaveBeenCalled()
    })
  })

  describe('フレンドコード生成', () => {
    it('既存のコードがあればそれを表示する', async () => {
      mockGetCode.mockResolvedValue({ code: 'EXIST123' })

      render(<FriendCodeModal isOpen={true} onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByTestId('my-friend-code')).toHaveTextContent('EXIST123')
      })
      expect(mockGenerateCode).not.toHaveBeenCalled()
    })

    it('コードがない場合は新規生成する', async () => {
      mockGetCode.mockResolvedValue({ code: null })

      render(<FriendCodeModal isOpen={true} onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByTestId('my-friend-code')).toHaveTextContent('ABCD1234')
      })
      expect(mockGenerateCode).toHaveBeenCalled()
    })
  })

  describe('フレンドリンク', () => {
    it('コード入力欄にテキストを入力できる', () => {
      render(<FriendCodeModal isOpen={true} onClose={mockOnClose} />)

      const input = screen.getByTestId('friend-code-input')
      fireEvent.change(input, { target: { value: 'WXYZ5678' } })
      expect(input).toHaveValue('WXYZ5678')
    })

    it('追加ボタンをクリックするとリンク処理が実行される', async () => {
      render(<FriendCodeModal isOpen={true} onClose={mockOnClose} />)

      const input = screen.getByTestId('friend-code-input')
      fireEvent.change(input, { target: { value: 'WXYZ5678' } })

      const linkButton = screen.getByTestId('link-friend-button')
      fireEvent.click(linkButton)

      await waitFor(() => {
        expect(mockLinkByCode).toHaveBeenCalledWith('WXYZ5678', 'テストユーザー')
      })
    })

    it('空のコードでは追加ボタンが無効になる', () => {
      render(<FriendCodeModal isOpen={true} onClose={mockOnClose} />)

      const linkButton = screen.getByTestId('link-friend-button')
      expect(linkButton).toBeDisabled()
    })

    it('リンク失敗時にエラーメッセージを表示する', async () => {
      mockLinkByCode.mockRejectedValue(new Error('リンクエラー'))

      render(<FriendCodeModal isOpen={true} onClose={mockOnClose} />)

      const input = screen.getByTestId('friend-code-input')
      fireEvent.change(input, { target: { value: 'BADCODE1' } })

      const linkButton = screen.getByTestId('link-friend-button')
      fireEvent.click(linkButton)

      await waitFor(() => {
        expect(screen.getByText(/フレンドの追加に失敗しました/)).toBeInTheDocument()
      })
    })
  })
})
