import { create } from 'zustand'
import type { AuthState } from './types'

/**
 * 認証状態管理ストア
 */
export const useAuthStore = create<AuthState>()((set) => ({
  status: 'loading',
  user: null,
  accessToken: null,
  pendingEmail: null,
  isAdmin: false,
  needsOnboarding: false,

  setStatus: (status) => set({ status }),

  setUser: (user) => set({ user }),

  setAccessToken: (token) => set({ accessToken: token }),

  setPendingEmail: (email) => set({ pendingEmail: email }),

  setIsAdmin: (isAdmin) => set({ isAdmin }),

  setNeedsOnboarding: (needs) => set({ needsOnboarding: needs }),

  login: (user, token) =>
    set({
      status: 'authenticated',
      user,
      accessToken: token,
      pendingEmail: null,
    }),

  logout: () =>
    set({
      status: 'unauthenticated',
      user: null,
      accessToken: null,
      pendingEmail: null,
      isAdmin: false,
      needsOnboarding: false,
    }),
}))
