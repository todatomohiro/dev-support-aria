import { create } from 'zustand'
import type { AdminUser, AdminUserDetail } from '@/types/admin'

interface AdminState {
  /** ユーザー一覧 */
  users: AdminUser[]
  /** ページネーショントークン */
  nextToken: string | null
  /** 選択中ユーザー詳細 */
  selectedUser: AdminUserDetail | null
  /** ローディング状態 */
  loading: boolean
  /** エラーメッセージ */
  error: string | null

  setUsers: (users: AdminUser[], nextToken: string | null) => void
  appendUsers: (users: AdminUser[], nextToken: string | null) => void
  setSelectedUser: (user: AdminUserDetail | null) => void
  updateUserRole: (userId: string, role: 'admin' | 'user') => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useAdminStore = create<AdminState>((set) => ({
  users: [],
  nextToken: null,
  selectedUser: null,
  loading: false,
  error: null,

  setUsers: (users, nextToken) => set({ users, nextToken }),
  appendUsers: (users, nextToken) => set((s) => ({ users: [...s.users, ...users], nextToken })),
  setSelectedUser: (user) => set({ selectedUser: user }),
  updateUserRole: (userId, role) => set((s) => ({
    users: s.users.map(u => u.userId === userId ? { ...u, role } : u),
    selectedUser: s.selectedUser?.userId === userId ? { ...s.selectedUser, role } : s.selectedUser,
  })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}))
