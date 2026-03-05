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
  setAuthenticated: (user: AuthUser, token: string) => void
  setUnauthenticated: () => void
  setLoading: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  user: null,
  idToken: null,
  setAuthenticated: (user, token) => set({ status: 'authenticated', user, idToken: token }),
  setUnauthenticated: () => set({ status: 'unauthenticated', user: null, idToken: null }),
  setLoading: () => set({ status: 'loading' }),
}))
