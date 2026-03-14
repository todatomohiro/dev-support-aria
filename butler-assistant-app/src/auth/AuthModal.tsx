import { useState, useCallback, useEffect } from 'react'
import { useAuthStore } from './authStore'
import {
  login,
  signup,
  confirmSignup,
  confirmMfaCode,
  forgotPassword,
  confirmForgotPassword,
  isAuthConfigured,
} from './authClient'
import type { AuthView } from './types'

/** ビュータイトル */
const VIEW_TITLES: Record<AuthView, string> = {
  login: 'ログイン',
  signup: 'アカウント作成',
  confirmSignUp: 'メール確認',
  totpChallenge: '二要素認証',
  forgotPassword: 'パスワードリセット',
  confirmForgotPassword: '新しいパスワード',
}


/**
 * 認証モーダル（ログイン / サインアップ / 確認コード / パスワードリセット）
 */
export function AuthModal({
  isOpen,
  onClose,
  initialView,
}: {
  isOpen: boolean
  onClose: () => void
  /** モーダルを開いた時の初期ビュー（省略時は login） */
  initialView?: AuthView
}) {
  const [view, setView] = useState<AuthView>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [code, setCode] = useState('')
  const [totpCode, setTotpCode] = useState('')
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
    setTotpCode('')
    setNewPassword('')
    setError(null)
    setIsSubmitting(false)
  }, [])

  /** モーダルが開かれた時に initialView を反映 */
  useEffect(() => {
    if (isOpen && initialView) {
      setView(initialView)
    }
  }, [isOpen, initialView])

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
        } else if (result.nextStep === 'CONFIRM_SIGN_IN_WITH_TOTP_CODE') {
          setView('totpChallenge')
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

  /** TOTP コード送信 */
  const handleTotpChallenge = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError(null)
      setIsSubmitting(true)
      try {
        await confirmMfaCode(totpCode)
        handleClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : '認証コードが正しくありません')
      } finally {
        setIsSubmitting(false)
      }
    },
    [totpCode, handleClose]
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
        if (result.autoSignedIn) {
          // autoSignIn 完了 → モーダルを閉じる
          handleClose()
        } else if (result.nextStep === 'CONFIRM_SIGN_UP') {
          // Pre Sign-up Lambda で自動確認される場合、そのままログインを試みる
          try {
            const loginResult = await login(email, password)
            if (loginResult.nextStep === 'DONE') {
              handleClose()
              return
            }
          } catch {
            // 自動確認が無効な環境ではフォールバック
          }
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
    'w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:border-blue-400 focus:shadow-[0_0_0_4px_rgba(59,130,246,0.1)] focus:bg-white dark:focus:bg-gray-700 outline-none transition-all text-[15px]'
  const btnPrimaryClass =
    'w-full py-3.5 px-4 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-gray-300 disabled:to-gray-300 dark:disabled:from-gray-700 dark:disabled:to-gray-700 disabled:shadow-none text-white font-bold rounded-2xl shadow-md transition-all active:scale-[0.98]'
  const linkClass =
    'text-sm text-blue-600 dark:text-blue-400 hover:underline cursor-pointer'

  return (
    <div
      className="fixed inset-0 bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 flex items-center justify-center z-50 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
      data-testid="auth-modal-overlay"
    >
      {/* PC: 2カラムカード / モバイル: 単一カード */}
      <div className="w-full md:w-[960px] md:max-w-[95vw] bg-white dark:bg-gray-900 rounded-2xl md:rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row max-h-[90vh] md:min-h-[520px]">
        {/* PC左パネル */}
        <div className="hidden md:flex flex-col w-[340px] shrink-0 bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 p-8 text-white relative overflow-hidden">
          <div className="absolute inset-0 opacity-10">
            <div className="absolute -top-20 -right-20 w-60 h-60 rounded-full bg-white/20" />
            <div className="absolute -bottom-10 -left-10 w-40 h-40 rounded-full bg-white/15" />
          </div>
          <div className="relative z-10 flex flex-col items-center justify-center h-full text-center">
            <div className="text-4xl font-extrabold tracking-tight">Ai-Ba</div>
            <div className="text-sm font-medium tracking-[4px] mt-1 text-blue-200">AI &nbsp; PARTNER</div>
            <div className="mt-6 text-sm text-blue-100 leading-relaxed">
              あなただけの相棒を<br />一緒に作りましょう
            </div>
          </div>
        </div>

        {/* 右パネル（フォーム） */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {/* ヘッダー */}
          <div className="flex items-center justify-between p-5 md:px-8 md:pt-8 md:pb-2">
            {/* モバイル用ロゴ */}
            <div className="md:hidden">
              <span className="text-lg font-extrabold bg-gradient-to-br from-blue-500 to-blue-700 bg-clip-text text-transparent">Ai-Ba</span>
            </div>
            <h2 className="hidden md:block text-xl font-bold text-gray-800 dark:text-gray-100">
              {VIEW_TITLES[view]}
            </h2>
            <button
              onClick={handleClose}
              className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              data-testid="auth-modal-close"
            >
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* モバイル用タイトル */}
          <div className="md:hidden px-5 pb-2">
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">
              {VIEW_TITLES[view]}
            </h2>
          </div>

          {/* エラー表示 */}
          {error && (
            <div className="mx-5 md:mx-8 p-3 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-xl text-sm" data-testid="auth-error">
              {error}
            </div>
          )}

          <div className="p-5 md:px-8 md:pb-8 md:pt-4">
            {/* ── ログインフォーム ── */}
            {view === 'login' && (
              <form onSubmit={handleLogin} className="space-y-4" data-testid="login-form">
                <div>
                  <label className="block text-[13px] font-semibold text-gray-500 dark:text-gray-400 mb-2">
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
                  <label className="block text-[13px] font-semibold text-gray-500 dark:text-gray-400 mb-2">
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
                <div className="pt-2">
                  <button type="submit" disabled={isSubmitting} className={btnPrimaryClass} data-testid="login-submit">
                    {isSubmitting ? 'ログイン中...' : 'ログイン'}
                  </button>
                </div>
                <div className="flex justify-between pt-1">
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
                  <label className="block text-[13px] font-semibold text-gray-500 dark:text-gray-400 mb-2">
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
                  <label className="block text-[13px] font-semibold text-gray-500 dark:text-gray-400 mb-2">
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
                  <label className="block text-[13px] font-semibold text-gray-500 dark:text-gray-400 mb-2">
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
                <div className="pt-2">
                  <button type="submit" disabled={isSubmitting} className={btnPrimaryClass} data-testid="signup-submit">
                    {isSubmitting ? '送信中...' : 'アカウント作成'}
                  </button>
                </div>
                <div className="pt-1">
                  <span onClick={() => switchView('login')} className={linkClass} data-testid="goto-login">
                    ログインに戻る
                  </span>
                </div>
              </form>
            )}

            {/* ── 確認コード入力フォーム ── */}
            {view === 'confirmSignUp' && (
              <form onSubmit={handleConfirmSignup} className="space-y-4" data-testid="confirm-form">
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                  メールに送信された確認コードを入力してください。
                </p>
                <div>
                  <label className="block text-[13px] font-semibold text-gray-500 dark:text-gray-400 mb-2">
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
                <div className="pt-2">
                  <button type="submit" disabled={isSubmitting} className={btnPrimaryClass} data-testid="confirm-submit">
                    {isSubmitting ? '確認中...' : '確認'}
                  </button>
                </div>
                <div className="pt-1">
                  <span onClick={() => switchView('login')} className={linkClass} data-testid="goto-login">
                    ログインに戻る
                  </span>
                </div>
              </form>
            )}

            {/* ── TOTP チャレンジフォーム ── */}
            {view === 'totpChallenge' && (
              <form onSubmit={handleTotpChallenge} className="space-y-4" data-testid="totp-form">
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                  認証アプリに表示されている6桁のコードを入力してください。
                </p>
                <div>
                  <label className="block text-[13px] font-semibold text-gray-500 dark:text-gray-400 mb-2">
                    認証コード
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    autoComplete="one-time-code"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    className={inputClass}
                    required
                    autoFocus
                    data-testid="totp-code"
                  />
                </div>
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isSubmitting || totpCode.length !== 6}
                    className={btnPrimaryClass}
                    data-testid="totp-submit"
                  >
                    {isSubmitting ? '確認中...' : '確認'}
                  </button>
                </div>
                <div className="pt-1">
                  <span onClick={() => { switchView('login'); setTotpCode('') }} className={linkClass} data-testid="goto-login">
                    ログインに戻る
                  </span>
                </div>
              </form>
            )}

            {/* ── パスワードリセット申請フォーム ── */}
            {view === 'forgotPassword' && (
              <form onSubmit={handleForgotPassword} className="space-y-4" data-testid="forgot-form">
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                  登録済みのメールアドレスにリセットコードを送信します。
                </p>
                <div>
                  <label className="block text-[13px] font-semibold text-gray-500 dark:text-gray-400 mb-2">
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
                <div className="pt-2">
                  <button type="submit" disabled={isSubmitting} className={btnPrimaryClass} data-testid="forgot-submit">
                    {isSubmitting ? '送信中...' : 'リセットコードを送信'}
                  </button>
                </div>
                <div className="pt-1">
                  <span onClick={() => switchView('login')} className={linkClass} data-testid="goto-login">
                    ログインに戻る
                  </span>
                </div>
              </form>
            )}

            {/* ── パスワードリセット確認フォーム ── */}
            {view === 'confirmForgotPassword' && (
              <form onSubmit={handleConfirmForgotPassword} className="space-y-4" data-testid="confirm-forgot-form">
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                  メールに送信されたコードと新しいパスワードを入力してください。
                </p>
                <div>
                  <label className="block text-[13px] font-semibold text-gray-500 dark:text-gray-400 mb-2">
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
                  <label className="block text-[13px] font-semibold text-gray-500 dark:text-gray-400 mb-2">
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
                <div className="pt-2">
                  <button type="submit" disabled={isSubmitting} className={btnPrimaryClass} data-testid="confirm-forgot-submit">
                    {isSubmitting ? '送信中...' : 'パスワードを変更'}
                  </button>
                </div>
                <div className="pt-1">
                  <span onClick={() => switchView('login')} className={linkClass} data-testid="goto-login">
                    ログインに戻る
                  </span>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
