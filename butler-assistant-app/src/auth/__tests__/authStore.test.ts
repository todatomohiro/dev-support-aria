import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore } from '../authStore'
import type { AuthUser } from '../types'

describe('authStore', () => {
  beforeEach(() => {
    // ストアをリセット
    useAuthStore.setState({
      status: 'loading',
      user: null,
      accessToken: null,
    })
  })

  const mockUser: AuthUser = {
    userId: 'user-123',
    email: 'test@example.com',
    displayName: 'Test User',
    avatarUrl: 'https://example.com/avatar.jpg',
  }

  describe('初期状態', () => {
    it('status が loading で開始する', () => {
      expect(useAuthStore.getState().status).toBe('loading')
    })

    it('user が null で開始する', () => {
      expect(useAuthStore.getState().user).toBeNull()
    })

    it('accessToken が null で開始する', () => {
      expect(useAuthStore.getState().accessToken).toBeNull()
    })
  })

  describe('setStatus', () => {
    it('status を更新する', () => {
      useAuthStore.getState().setStatus('authenticated')
      expect(useAuthStore.getState().status).toBe('authenticated')
    })

    it('unauthenticated に更新する', () => {
      useAuthStore.getState().setStatus('unauthenticated')
      expect(useAuthStore.getState().status).toBe('unauthenticated')
    })
  })

  describe('setUser', () => {
    it('user を設定する', () => {
      useAuthStore.getState().setUser(mockUser)
      expect(useAuthStore.getState().user).toEqual(mockUser)
    })

    it('user を null にリセットする', () => {
      useAuthStore.getState().setUser(mockUser)
      useAuthStore.getState().setUser(null)
      expect(useAuthStore.getState().user).toBeNull()
    })
  })

  describe('setAccessToken', () => {
    it('accessToken を設定する', () => {
      useAuthStore.getState().setAccessToken('token-abc')
      expect(useAuthStore.getState().accessToken).toBe('token-abc')
    })
  })

  describe('login', () => {
    it('user, accessToken, status を一括設定する', () => {
      useAuthStore.getState().login(mockUser, 'token-xyz')

      const state = useAuthStore.getState()
      expect(state.status).toBe('authenticated')
      expect(state.user).toEqual(mockUser)
      expect(state.accessToken).toBe('token-xyz')
    })
  })

  describe('logout', () => {
    it('全状態をリセットする', () => {
      // ログイン状態にする
      useAuthStore.getState().login(mockUser, 'token-xyz')

      // ログアウト
      useAuthStore.getState().logout()

      const state = useAuthStore.getState()
      expect(state.status).toBe('unauthenticated')
      expect(state.user).toBeNull()
      expect(state.accessToken).toBeNull()
    })
  })

  describe('状態遷移', () => {
    it('loading → authenticated → unauthenticated の遷移', () => {
      expect(useAuthStore.getState().status).toBe('loading')

      useAuthStore.getState().login(mockUser, 'token')
      expect(useAuthStore.getState().status).toBe('authenticated')

      useAuthStore.getState().logout()
      expect(useAuthStore.getState().status).toBe('unauthenticated')
    })

    it('loading → unauthenticated（ゲストモード）', () => {
      expect(useAuthStore.getState().status).toBe('loading')

      useAuthStore.getState().setStatus('unauthenticated')
      expect(useAuthStore.getState().status).toBe('unauthenticated')
      expect(useAuthStore.getState().user).toBeNull()
    })
  })
})
