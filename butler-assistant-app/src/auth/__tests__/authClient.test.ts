import { describe, it, expect, vi, beforeEach } from 'vitest'

// Amplify モック
const mockSignIn = vi.fn()
const mockSignUp = vi.fn()
const mockConfirmSignUp = vi.fn()
const mockResetPassword = vi.fn()
const mockConfirmResetPassword = vi.fn()
const mockSignOut = vi.fn()
const mockGetCurrentUser = vi.fn()
const mockFetchAuthSession = vi.fn()
const mockHubListen = vi.fn()
const mockConfigure = vi.fn()

vi.mock('aws-amplify', () => ({
  Amplify: {
    configure: (...args: unknown[]) => mockConfigure(...args),
  },
}))

vi.mock('aws-amplify/auth', () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
  signUp: (...args: unknown[]) => mockSignUp(...args),
  confirmSignUp: (...args: unknown[]) => mockConfirmSignUp(...args),
  resetPassword: (...args: unknown[]) => mockResetPassword(...args),
  confirmResetPassword: (...args: unknown[]) => mockConfirmResetPassword(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  getCurrentUser: () => mockGetCurrentUser(),
  fetchAuthSession: () => mockFetchAuthSession(),
}))

vi.mock('aws-amplify/utils', () => ({
  Hub: {
    listen: (...args: unknown[]) => mockHubListen(...args),
  },
}))

// 環境変数のモック
const mockEnv = {
  VITE_COGNITO_USER_POOL_ID: 'ap-northeast-1_TestPool',
  VITE_COGNITO_CLIENT_ID: 'test-client-id',
  VITE_AWS_REGION: 'ap-northeast-1',
}

describe('authClient', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    // import.meta.env のモック
    vi.stubGlobal('import', { meta: { env: { ...mockEnv, DEV: false } } })
  })

  describe('isAuthConfigured', () => {
    it('環境変数が設定されている場合は true を返す', async () => {
      vi.stubEnv('VITE_COGNITO_USER_POOL_ID', 'ap-northeast-1_TestPool')
      vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'test-client-id')

      const { isAuthConfigured } = await import('../authClient')
      const result = isAuthConfigured()
      expect(typeof result).toBe('boolean')
    })

    it('環境変数が未設定の場合は false を返す', async () => {
      vi.stubEnv('VITE_COGNITO_USER_POOL_ID', '')
      vi.stubEnv('VITE_COGNITO_CLIENT_ID', '')

      const { isAuthConfigured } = await import('../authClient')
      expect(isAuthConfigured()).toBe(false)
    })
  })

  describe('login', () => {
    it('signIn をメール/パスワードで呼び出す', async () => {
      mockSignIn.mockResolvedValue({
        nextStep: { signInStep: 'DONE' },
      })

      const { login } = await import('../authClient')
      const result = await login('test@example.com', 'password123')

      expect(mockSignIn).toHaveBeenCalledWith({
        username: 'test@example.com',
        password: 'password123',
      })
      expect(result).toEqual({ nextStep: 'DONE' })
    })

    it('確認が必要な場合は CONFIRM_SIGN_UP を返す', async () => {
      mockSignIn.mockResolvedValue({
        nextStep: { signInStep: 'CONFIRM_SIGN_UP' },
      })

      const { login } = await import('../authClient')
      const result = await login('test@example.com', 'password123')

      expect(result).toEqual({ nextStep: 'CONFIRM_SIGN_UP' })
    })
  })

  describe('signup', () => {
    it('signUp をメール/パスワードで呼び出す', async () => {
      mockSignUp.mockResolvedValue({
        nextStep: { signUpStep: 'CONFIRM_SIGN_UP' },
      })

      const { signup } = await import('../authClient')
      const result = await signup('new@example.com', 'password123')

      expect(mockSignUp).toHaveBeenCalledWith({
        username: 'new@example.com',
        password: 'password123',
        options: {
          userAttributes: { email: 'new@example.com' },
        },
      })
      expect(result).toEqual({ nextStep: 'CONFIRM_SIGN_UP' })
    })
  })

  describe('confirmSignup', () => {
    it('confirmSignUp を確認コードで呼び出す', async () => {
      mockConfirmSignUp.mockResolvedValue({})

      const { confirmSignup } = await import('../authClient')
      await confirmSignup('test@example.com', '123456')

      expect(mockConfirmSignUp).toHaveBeenCalledWith({
        username: 'test@example.com',
        confirmationCode: '123456',
      })
    })
  })

  describe('forgotPassword', () => {
    it('resetPassword をメールで呼び出す', async () => {
      mockResetPassword.mockResolvedValue({})

      const { forgotPassword } = await import('../authClient')
      await forgotPassword('test@example.com')

      expect(mockResetPassword).toHaveBeenCalledWith({
        username: 'test@example.com',
      })
    })
  })

  describe('confirmForgotPassword', () => {
    it('confirmResetPassword をコード/新パスワードで呼び出す', async () => {
      mockConfirmResetPassword.mockResolvedValue({})

      const { confirmForgotPassword } = await import('../authClient')
      await confirmForgotPassword('test@example.com', '123456', 'newPass123')

      expect(mockConfirmResetPassword).toHaveBeenCalledWith({
        username: 'test@example.com',
        confirmationCode: '123456',
        newPassword: 'newPass123',
      })
    })
  })

  describe('logout', () => {
    it('signOut を呼び出す', async () => {
      const { logout } = await import('../authClient')
      await logout()
      expect(mockSignOut).toHaveBeenCalled()
    })
  })

  describe('getAuthUser', () => {
    it('認証済みユーザー情報を返す', async () => {
      mockGetCurrentUser.mockResolvedValue({
        userId: 'user-123',
        username: 'testuser',
      })
      mockFetchAuthSession.mockResolvedValue({
        tokens: {
          idToken: {
            payload: {
              email: 'test@example.com',
              name: 'Test User',
              picture: 'https://example.com/avatar.jpg',
            },
          },
        },
      })

      const { getAuthUser } = await import('../authClient')
      const user = await getAuthUser()

      expect(user).toEqual({
        userId: 'user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        avatarUrl: 'https://example.com/avatar.jpg',
      })
    })

    it('未認証の場合は null を返す', async () => {
      mockGetCurrentUser.mockRejectedValue(new Error('Not authenticated'))

      const { getAuthUser } = await import('../authClient')
      const user = await getAuthUser()

      expect(user).toBeNull()
    })
  })

  describe('getIdToken', () => {
    it('IDトークンを返す', async () => {
      mockFetchAuthSession.mockResolvedValue({
        tokens: {
          idToken: {
            toString: () => 'mock-id-token',
          },
        },
      })

      const { getIdToken } = await import('../authClient')
      const token = await getIdToken()

      expect(token).toBe('mock-id-token')
    })

    it('セッションがない場合は null を返す', async () => {
      mockFetchAuthSession.mockRejectedValue(new Error('No session'))

      const { getIdToken } = await import('../authClient')
      const token = await getIdToken()

      expect(token).toBeNull()
    })
  })

  describe('listenAuthEvents', () => {
    it('Hub.listen を呼び出してコールバックを登録する', async () => {
      const callback = vi.fn()
      const mockUnsubscribe = vi.fn()
      mockHubListen.mockReturnValue(mockUnsubscribe)

      const { listenAuthEvents } = await import('../authClient')
      const unsubscribe = listenAuthEvents(callback)

      expect(mockHubListen).toHaveBeenCalledWith('auth', expect.any(Function))
      expect(unsubscribe).toBe(mockUnsubscribe)
    })

    it('Hub イベントを受信するとコールバックを呼び出す', async () => {
      const callback = vi.fn()
      mockHubListen.mockImplementation((_channel: string, handler: (data: { payload: { event: string } }) => void) => {
        // イベントをシミュレート
        handler({ payload: { event: 'signedIn' } })
        return vi.fn()
      })

      const { listenAuthEvents } = await import('../authClient')
      listenAuthEvents(callback)

      expect(callback).toHaveBeenCalledWith('signedIn')
    })
  })
})
