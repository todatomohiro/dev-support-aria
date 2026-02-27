import { useState, useCallback } from 'react'
import { useAuthStore } from './authStore'
import {
  login,
  signup,
  confirmSignup,
  forgotPassword,
  confirmForgotPassword,
  isAuthConfigured,
} from './authClient'
import type { AuthView } from './types'

/**
 * 認証モーダル（ログイン / サインアップ / 確認コード / パスワードリセット）
 */
export function AuthModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) {
  const [view, setView] = useState<AuthView>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { setPendingEmail } = useAuthStore()

  /** フォーム状態をリセット */
  const resetForm = useCallback(() => {
    setEmail('')
    setPassword('')
    setPasswordConfirm('')
    setCode('')
    setNewPassword('')
    setError(null)
    setIsSubmitting(false)
  }, [])

  /** ビュー切替時にエラーをクリア */
  const switchView = useCallback(
    (nextView: AuthView) => {
      setError(null)
      setView(nextView)
    },
    []
  )

  /** モーダルを閉じる */
  const handleClose = useCallback(() => {
    resetForm()
    setView('login')
    onClose()
  }, [onClose, resetForm])

  /** ログイン送信 */
  const handleLogin = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError(null)
      setIsSubmitting(true)
      try {
        const result = await login(email, password)
        if (result.nextStep === 'CONFIRM_SIGN_UP') {
          setPendingEmail(email)
          setView('confirmSignUp')
        } else {
          handleClose()
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'ログインに失敗しました')
      } finally {
        setIsSubmitting(false)
      }
    },
    [email, password, setPendingEmail, handleClose]
  )

  /** サインアップ送信 */
  const handleSignup = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError(null)

      if (password !== passwordConfirm) {
        setError('パスワードが一致しません')
        return
      }

      setIsSubmitting(true)
      try {
        const result = await signup(email, password)
        if (result.nextStep === 'CONFIRM_SIGN_UP') {
          setPendingEmail(email)
          setView('confirmSignUp')
        } else {
          handleClose()
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'アカウント作成に失敗しました')
      } finally {
        setIsSubmitting(false)
      }
    },
    [email, password, passwordConfirm, setPendingEmail, handleClose]
  )

  /** 確認コード送信 */
  const handleConfirmSignup = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError(null)
      setIsSubmitting(true)
      try {
        const pendingEmail = useAuthStore.getState().pendingEmail ?? email
        await confirmSignup(pendingEmail, code)
        // 確認完了後ログイン画面へ
        resetForm()
        setView('login')
      } catch (err) {
        setError(err instanceof Error ? err.message : '確認コードが無効です')
      } finally {
        setIsSubmitting(false)
      }
    },
    [email, code, resetForm]
  )

  /** パスワードリセット申請 */
  const handleForgotPassword = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError(null)
      setIsSubmitting(true)
      try {
        await forgotPassword(email)
        setPendingEmail(email)
        setView('confirmForgotPassword')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'パスワードリセットに失敗しました')
      } finally {
        setIsSubmitting(false)
      }
    },
    [email, setPendingEmail]
  )

  /** パスワードリセット確認 */
  const handleConfirmForgotPassword = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError(null)
      setIsSubmitting(true)
      try {
        const pendingEmail = useAuthStore.getState().pendingEmail ?? email
        await confirmForgotPassword(pendingEmail, code, newPassword)
        resetForm()
        setView('login')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'パスワードリセットに失敗しました')
      } finally {
        setIsSubmitting(false)
      }
    },
    [email, code, newPassword, resetForm]
  )

  if (!isOpen || !isAuthConfigured()) return null

  const inputClass =
    'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'
  const btnPrimaryClass =
    'w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors'
  const linkClass =
    'text-sm text-blue-600 dark:text-blue-400 hover:underline cursor-pointer'

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
      data-testid="auth-modal-overlay"
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {view === 'login' && 'ログイン'}
            {view === 'signup' && 'アカウント作成'}
            {view === 'confirmSignUp' && 'メール確認'}
            {view === 'forgotPassword' && 'パスワードリセット'}
            {view === 'confirmForgotPassword' && '新しいパスワード'}
          </h2>
          <button
            onClick={handleClose}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
            data-testid="auth-modal-close"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="mx-4 mt-4 p-3 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg text-sm" data-testid="auth-error">
            {error}
          </div>
        )}

        <div className="p-4">
          {/* ── ログインフォーム ── */}
          {view === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4" data-testid="login-form">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  メールアドレス
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  required
                  autoComplete="email"
                  data-testid="login-email"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  パスワード
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                  required
                  autoComplete="current-password"
                  data-testid="login-password"
                />
              </div>
              <button type="submit" disabled={isSubmitting} className={btnPrimaryClass} data-testid="login-submit">
                {isSubmitting ? 'ログイン中...' : 'ログイン'}
              </button>
              <div className="flex justify-between">
                <span onClick={() => switchView('signup')} className={linkClass} data-testid="goto-signup">
                  アカウント作成
                </span>
                <span onClick={() => switchView('forgotPassword')} className={linkClass} data-testid="goto-forgot">
                  パスワードを忘れた
                </span>
              </div>
            </form>
          )}

          {/* ── サインアップフォーム ── */}
          {view === 'signup' && (
            <form onSubmit={handleSignup} className="space-y-4" data-testid="signup-form">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  メールアドレス
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  required
                  autoComplete="email"
                  data-testid="signup-email"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  パスワード
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                  required
                  autoComplete="new-password"
                  data-testid="signup-password"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  パスワード（確認）
                </label>
                <input
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  className={inputClass}
                  required
                  autoComplete="new-password"
                  data-testid="signup-password-confirm"
                />
              </div>
              <button type="submit" disabled={isSubmitting} className={btnPrimaryClass} data-testid="signup-submit">
                {isSubmitting ? '送信中...' : 'アカウント作成'}
              </button>
              <div>
                <span onClick={() => switchView('login')} className={linkClass} data-testid="goto-login">
                  ログインに戻る
                </span>
              </div>
            </form>
          )}

          {/* ── 確認コード入力フォーム ── */}
          {view === 'confirmSignUp' && (
            <form onSubmit={handleConfirmSignup} className="space-y-4" data-testid="confirm-form">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                メールに送信された確認コードを入力してください。
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  確認コード
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className={inputClass}
                  required
                  autoComplete="one-time-code"
                  placeholder="123456"
                  data-testid="confirm-code"
                />
              </div>
              <button type="submit" disabled={isSubmitting} className={btnPrimaryClass} data-testid="confirm-submit">
                {isSubmitting ? '確認中...' : '確認'}
              </button>
              <div>
                <span onClick={() => switchView('login')} className={linkClass} data-testid="goto-login">
                  ログインに戻る
                </span>
              </div>
            </form>
          )}

          {/* ── パスワードリセット申請フォーム ── */}
          {view === 'forgotPassword' && (
            <form onSubmit={handleForgotPassword} className="space-y-4" data-testid="forgot-form">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                登録済みのメールアドレスにリセットコードを送信します。
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  メールアドレス
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  required
                  autoComplete="email"
                  data-testid="forgot-email"
                />
              </div>
              <button type="submit" disabled={isSubmitting} className={btnPrimaryClass} data-testid="forgot-submit">
                {isSubmitting ? '送信中...' : 'リセットコードを送信'}
              </button>
              <div>
                <span onClick={() => switchView('login')} className={linkClass} data-testid="goto-login">
                  ログインに戻る
                </span>
              </div>
            </form>
          )}

          {/* ── パスワードリセット確認フォーム ── */}
          {view === 'confirmForgotPassword' && (
            <form onSubmit={handleConfirmForgotPassword} className="space-y-4" data-testid="confirm-forgot-form">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                メールに送信されたコードと新しいパスワードを入力してください。
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  リセットコード
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className={inputClass}
                  required
                  autoComplete="one-time-code"
                  placeholder="123456"
                  data-testid="confirm-forgot-code"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  新しいパスワード
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={inputClass}
                  required
                  autoComplete="new-password"
                  data-testid="confirm-forgot-password"
                />
              </div>
              <button type="submit" disabled={isSubmitting} className={btnPrimaryClass} data-testid="confirm-forgot-submit">
                {isSubmitting ? '送信中...' : 'パスワードを変更'}
              </button>
              <div>
                <span onClick={() => switchView('login')} className={linkClass} data-testid="goto-login">
                  ログインに戻る
                </span>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
