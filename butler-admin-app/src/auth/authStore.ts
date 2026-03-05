import { create } from 'zustand'

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

interface AuthUser {
  userId: string
  email: string
}

interface AuthState {
  status: AuthStatus
  user: AuthUser | null
  idToken: string | null
  mfaEnabled: boolean
  setAuthenticated: (user: AuthUser, token: string) => void
  setUnauthenticated: () => void
  setLoading: () => void
  setMfaEnabled: (enabled: boolean) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  user: null,
  idToken: null,
  mfaEnabled: false,
  setAuthenticated: (user, token) => set({ status: 'authenticated', user, idToken: token }),
  setUnauthenticated: () => set({ status: 'unauthenticated', user: null, idToken: null, mfaEnabled: false }),
  setLoading: () => set({ status: 'loading' }),
  setMfaEnabled: (enabled) => set({ mfaEnabled: enabled }),
}))
