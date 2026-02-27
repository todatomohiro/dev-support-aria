import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { AuthModal } from '../AuthModal'

vi.mock('../authClient', () => ({
  login: vi.fn(),
  signup: vi.fn(),
  confirmSignup: vi.fn(),
  forgotPassword: vi.fn(),
  confirmForgotPassword: vi.fn(),
  isAuthConfigured: vi.fn(() => true),
}))

import {
  login,
  signup,
  confirmSignup,
  forgotPassword,
  confirmForgotPassword,
  isAuthConfigured,
} from '../authClient'

describe('AuthModal', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isAuthConfigured).mockReturnValue(true)
  })

  afterEach(() => cleanup())

  describe('表示制御', () => {
    it('isOpen=false の場合は何も表示しない', () => {
      render(<AuthModal isOpen={false} onClose={mockOnClose} />)
      expect(screen.queryByTestId('auth-modal-overlay')).not.toBeInTheDocument()
    })

    it('isAuthConfigured()=false の場合は何も表示しない', () => {
      vi.mocked(isAuthConfigured).mockReturnValue(false)
      render(<AuthModal isOpen={true} onClose={mockOnClose} />)
      expect(screen.queryByTestId('auth-modal-overlay')).not.toBeInTheDocument()
    })

    it('isOpen=true でログインフォームが表示される', () => {
      render(<AuthModal isOpen={true} onClose={mockOnClose} />)
      expect(screen.getByTestId('auth-modal-overlay')).toBeInTheDocument()
      expect(screen.getByTestId('login-form')).toBeInTheDocument()
    })
  })

  describe('ログインフォーム', () => {
    it('メール/パスワード入力 → 送信 → login() が呼ばれる', async () => {
      vi.mocked(login).mockResolvedValue({ nextStep: 'DONE' })
      render(<AuthModal isOpen={true} onClose={mockOnClose} />)

      fireEvent.change(screen.getByTestId('login-email'), {
        target: { value: 'test@example.com' },
      })
      fireEvent.change(screen.getByTestId('login-password'), {
        target: { value: 'password123' },
      })
      fireEvent.click(screen.getByTestId('login-submit'))

      await waitFor(() => {
        expect(login).toHaveBeenCalledWith('test@example.com', 'password123')
      })
    })

    it('ログイン成功時に onClose が呼ばれる', async () => {
      vi.mocked(login).mockResolvedValue({ nextStep: 'DONE' })
      render(<AuthModal isOpen={true} onClose={mockOnClose} />)

      fireEvent.change(screen.getByTestId('login-email'), {
        target: { value: 'test@example.com' },
      })
      fireEvent.change(screen.getByTestId('login-password'), {
        target: { value: 'password123' },
      })
      fireEvent.click(screen.getByTestId('login-submit'))

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled()
      })
    })

    it('CONFIRM_SIGN_UP が返された場合、確認コードフォームに遷移', async () => {
      vi.mocked(login).mockResolvedValue({ nextStep: 'CONFIRM_SIGN_UP' })
      render(<AuthModal isOpen={true} onClose={mockOnClose} />)

      fireEvent.change(screen.getByTestId('login-email'), {
        target: { value: 'test@example.com' },
      })
      fireEvent.change(screen.getByTestId('login-password'), {
        target: { value: 'password123' },
      })
      fireEvent.click(screen.getByTestId('login-submit'))

      await waitFor(() => {
        expect(screen.getByTestId('confirm-form')).toBeInTheDocument()
      })
    })

    it('エラー時にエラーメッセージが表示される', async () => {
      vi.mocked(login).mockRejectedValue(new Error('認証に失敗しました'))
      render(<AuthModal isOpen={true} onClose={mockOnClose} />)

      fireEvent.change(screen.getByTestId('login-email'), {
        target: { value: 'test@example.com' },
      })
      fireEvent.change(screen.getByTestId('login-password'), {
        target: { value: 'wrong' },
      })
      fireEvent.click(screen.getByTestId('login-submit'))

      await waitFor(() => {
        expect(screen.getByTestId('auth-error')).toHaveTextContent('認証に失敗しました')
      })
    })

    it('送信中はボタンが disabled', async () => {
      let resolveLogin: (value: { nextStep: string }) => void
      vi.mocked(login).mockImplementation(
        () => new Promise((resolve) => { resolveLogin = resolve })
      )
      render(<AuthModal isOpen={true} onClose={mockOnClose} />)

      fireEvent.change(screen.getByTestId('login-email'), {
        target: { value: 'test@example.com' },
      })
      fireEvent.change(screen.getByTestId('login-password'), {
        target: { value: 'password123' },
      })
      fireEvent.click(screen.getByTestId('login-submit'))

      await waitFor(() => {
        expect(screen.getByTestId('login-submit')).toBeDisabled()
      })

      resolveLogin!({ nextStep: 'DONE' })

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled()
      })
    })
  })

  describe('サインアップフォーム', () => {
    it('「アカウント作成」リンクでサインアップフォームに遷移', () => {
      render(<AuthModal isOpen={true} onClose={mockOnClose} />)

      fireEvent.click(screen.getByTestId('goto-signup'))
      expect(screen.getByTestId('signup-form')).toBeInTheDocument()
    })

    it('メール/パスワード/パスワード確認入力 → 送信 → signup() が呼ばれる', async () => {
      vi.mocked(signup).mockResolvedValue({ nextStep: 'CONFIRM_SIGN_UP' })
      render(<AuthModal isOpen={true} onClose={mockOnClose} />)

      fireEvent.click(screen.getByTestId('goto-signup'))

      fireEvent.change(screen.getByTestId('signup-email'), {
        target: { value: 'new@example.com' },
      })
      fireEvent.change(screen.getByTestId('signup-password'), {
        target: { value: 'newpass123' },
      })
      fireEvent.change(screen.getByTestId('signup-password-confirm'), {
        target: { value: 'newpass123' },
      })
      fireEvent.click(screen.getByTestId('signup-submit'))

      await waitFor(() => {
        expect(signup).toHaveBeenCalledWith('new@example.com', 'newpass123')
      })
    })

    it('パスワード不一致時にエラー表示（API 呼び出しなし）', async () => {
      render(<AuthModal isOpen={true} onClose={mockOnClose} />)

      fireEvent.click(screen.getByTestId('goto-signup'))

      fireEvent.change(screen.getByTestId('signup-email'), {
        target: { value: 'new@example.com' },
      })
      fireEvent.change(screen.getByTestId('signup-password'), {
        target: { value: 'pass1' },
      })
      fireEvent.change(screen.getByTestId('signup-password-confirm'), {
        target: { value: 'pass2' },
      })
      fireEvent.click(screen.getByTestId('signup-submit'))

      await waitFor(() => {
        expect(screen.getByTestId('auth-error')).toHaveTextContent('パスワードが一致しません')
      })
      expect(signup).not.toHaveBeenCalled()
    })

    it('CONFIRM_SIGN_UP で確認コードフォームへ遷移', async () => {
      vi.mocked(signup).mockResolvedValue({ nextStep: 'CONFIRM_SIGN_UP' })
      render(<AuthModal isOpen={true} onClose={mockOnClose} />)

      fireEvent.click(screen.getByTestId('goto-signup'))

      fireEvent.change(screen.getByTestId('signup-email'), {
        target: { value: 'new@example.com' },
      })
      fireEvent.change(screen.getByTestId('signup-password'), {
        target: { value: 'newpass123' },
      })
      fireEvent.change(screen.getByTestId('signup-password-confirm'), {
        target: { value: 'newpass123' },
      })
      fireEvent.click(screen.getByTestId('signup-submit'))

      await waitFor(() => {
        expect(screen.getByTestId('confirm-form')).toBeInTheDocument()
      })
    })

    it('「ログインに戻る」でログインフォームに戻る', () => {
      render(<AuthModal isOpen={true} onClose={mockOnClose} />)

      fireEvent.click(screen.getByTestId('goto-signup'))
      expect(screen.getByTestId('signup-form')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('goto-login'))
      expect(screen.getByTestId('login-form')).toBeInTheDocument()
    })
  })

  describe('確認コードフォーム', () => {
    it('コード入力 → 送信 → confirmSignup() が呼ばれる', async () => {
      vi.mocked(login).mockResolvedValue({ nextStep: 'CONFIRM_SIGN_UP' })
      vi.mocked(confirmSignup).mockResolvedValue(undefined)
      render(<AuthModal isOpen={true} onClose={mockOnClose} />)

      // ログインして確認コードフォームへ遷移
      fireEvent.change(screen.getByTestId('login-email'), {
        target: { value: 'test@example.com' },
      })
      fireEvent.change(screen.getByTestId('login-password'), {
        target: { value: 'password123' },
      })
      fireEvent.click(screen.getByTestId('login-submit'))

      await waitFor(() => {
        expect(screen.getByTestId('confirm-form')).toBeInTheDocument()
      })

      fireEvent.change(screen.getByTestId('confirm-code'), {
        target: { value: '123456' },
      })
      fireEvent.click(screen.getByTestId('confirm-submit'))

      await waitFor(() => {
        expect(confirmSignup).toHaveBeenCalledWith('test@example.com', '123456')
      })
    })

    it('成功後ログインフォームに戻る', async () => {
      vi.mocked(login).mockResolvedValue({ nextStep: 'CONFIRM_SIGN_UP' })
      vi.mocked(confirmSignup).mockResolvedValue(undefined)
      render(<AuthModal isOpen={true} onClose={mockOnClose} />)

      fireEvent.change(screen.getByTestId('login-email'), {
        target: { value: 'test@example.com' },
      })
      fireEvent.change(screen.getByTestId('login-password'), {
        target: { value: 'password123' },
      })
      fireEvent.click(screen.getByTestId('login-submit'))

      await waitFor(() => {
        expect(screen.getByTestId('confirm-form')).toBeInTheDocument()
      })

      fireEvent.change(screen.getByTestId('confirm-code'), {
        target: { value: '123456' },
      })
      fireEvent.click(screen.getByTestId('confirm-submit'))

      await waitFor(() => {
        expect(screen.getByTestId('login-form')).toBeInTheDocument()
      })
    })

    it('エラー時にエラーメッセージ表示', async () => {
      vi.mocked(login).mockResolvedValue({ nextStep: 'CONFIRM_SIGN_UP' })
      vi.mocked(confirmSignup).mockRejectedValue(new Error('コードが無効です'))
      render(<AuthModal isOpen={true} onClose={mockOnClose} />)

      fireEvent.change(screen.getByTestId('login-email'), {
        target: { value: 'test@example.com' },
      })
      fireEvent.change(screen.getByTestId('login-password'), {
        target: { value: 'password123' },
      })
      fireEvent.click(screen.getByTestId('login-submit'))

      await waitFor(() => {
        expect(screen.getByTestId('confirm-form')).toBeInTheDocument()
      })

      fireEvent.change(screen.getByTestId('confirm-code'), {
        target: { value: 'wrong' },
      })
      fireEvent.click(screen.getByTestId('confirm-submit'))

      await waitFor(() => {
        expect(screen.getByTestId('auth-error')).toHaveTextContent('コードが無効です')
      })
    })
  })

  describe('パスワードリセットフォーム', () => {
    it('「パスワードを忘れた」リンクでリセットフォームに遷移', () => {
      render(<AuthModal isOpen={true} onClose={mockOnClose} />)

      fireEvent.click(screen.getByTestId('goto-forgot'))
      expect(screen.getByTestId('forgot-form')).toBeInTheDocument()
    })

    it('メール入力 → 送信 → forgotPassword() が呼ばれる', async () => {
      vi.mocked(forgotPassword).mockResolvedValue(undefined)
      render(<AuthModal isOpen={true} onClose={mockOnClose} />)

      fireEvent.click(screen.getByTestId('goto-forgot'))

      fireEvent.change(screen.getByTestId('forgot-email'), {
        target: { value: 'reset@example.com' },
      })
      fireEvent.click(screen.getByTestId('forgot-submit'))

      await waitFor(() => {
        expect(forgotPassword).toHaveBeenCalledWith('reset@example.com')
      })
    })

    it('成功後パスワードリセット確認フォームに遷移', async () => {
      vi.mocked(forgotPassword).mockResolvedValue(undefined)
      render(<AuthModal isOpen={true} onClose={mockOnClose} />)

      fireEvent.click(screen.getByTestId('goto-forgot'))

      fireEvent.change(screen.getByTestId('forgot-email'), {
        target: { value: 'reset@example.com' },
      })
      fireEvent.click(screen.getByTestId('forgot-submit'))

      await waitFor(() => {
        expect(screen.getByTestId('confirm-forgot-form')).toBeInTheDocument()
      })
    })
  })

  describe('パスワードリセット確認フォーム', () => {
    it('コード/新パスワード入力 → 送信 → confirmForgotPassword() が呼ばれる', async () => {
      vi.mocked(forgotPassword).mockResolvedValue(undefined)
      vi.mocked(confirmForgotPassword).mockResolvedValue(undefined)
      render(<AuthModal isOpen={true} onClose={mockOnClose} />)

      // パスワードリセットフォームへ遷移
      fireEvent.click(screen.getByTestId('goto-forgot'))
      fireEvent.change(screen.getByTestId('forgot-email'), {
        target: { value: 'reset@example.com' },
      })
      fireEvent.click(screen.getByTestId('forgot-submit'))

      await waitFor(() => {
        expect(screen.getByTestId('confirm-forgot-form')).toBeInTheDocument()
      })

      fireEvent.change(screen.getByTestId('confirm-forgot-code'), {
        target: { value: '654321' },
      })
      fireEvent.change(screen.getByTestId('confirm-forgot-password'), {
        target: { value: 'newpass456' },
      })
      fireEvent.click(screen.getByTestId('confirm-forgot-submit'))

      await waitFor(() => {
        expect(confirmForgotPassword).toHaveBeenCalledWith(
          'reset@example.com',
          '654321',
          'newpass456'
        )
      })
    })

    it('成功後ログインフォームに戻る', async () => {
      vi.mocked(forgotPassword).mockResolvedValue(undefined)
      vi.mocked(confirmForgotPassword).mockResolvedValue(undefined)
      render(<AuthModal isOpen={true} onClose={mockOnClose} />)

      fireEvent.click(screen.getByTestId('goto-forgot'))
      fireEvent.change(screen.getByTestId('forgot-email'), {
        target: { value: 'reset@example.com' },
      })
      fireEvent.click(screen.getByTestId('forgot-submit'))

      await waitFor(() => {
        expect(screen.getByTestId('confirm-forgot-form')).toBeInTheDocument()
      })

      fireEvent.change(screen.getByTestId('confirm-forgot-code'), {
        target: { value: '654321' },
      })
      fireEvent.change(screen.getByTestId('confirm-forgot-password'), {
        target: { value: 'newpass456' },
      })
      fireEvent.click(screen.getByTestId('confirm-forgot-submit'))

      await waitFor(() => {
        expect(screen.getByTestId('login-form')).toBeInTheDocument()
      })
    })
  })

  describe('モーダル操作', () => {
    it('閉じるボタンで onClose が呼ばれる', () => {
      render(<AuthModal isOpen={true} onClose={mockOnClose} />)

      fireEvent.click(screen.getByTestId('auth-modal-close'))
      expect(mockOnClose).toHaveBeenCalled()
    })

    it('オーバーレイクリックで onClose が呼ばれる', () => {
      render(<AuthModal isOpen={true} onClose={mockOnClose} />)

      fireEvent.click(screen.getByTestId('auth-modal-overlay'))
      expect(mockOnClose).toHaveBeenCalled()
    })

    it('ビュー切替時にエラーがクリアされる', async () => {
      vi.mocked(login).mockRejectedValue(new Error('エラー'))
      render(<AuthModal isOpen={true} onClose={mockOnClose} />)

      // エラーを発生させる
      fireEvent.change(screen.getByTestId('login-email'), {
        target: { value: 'test@example.com' },
      })
      fireEvent.change(screen.getByTestId('login-password'), {
        target: { value: 'wrong' },
      })
      fireEvent.click(screen.getByTestId('login-submit'))

      await waitFor(() => {
        expect(screen.getByTestId('auth-error')).toBeInTheDocument()
      })

      // ビューを切り替え
      fireEvent.click(screen.getByTestId('goto-signup'))

      expect(screen.queryByTestId('auth-error')).not.toBeInTheDocument()
    })
  })
})
