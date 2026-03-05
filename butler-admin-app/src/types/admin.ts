/** ユーザーロール */
export type UserRole = 'admin' | 'user'

/** ユーザー一覧アイテム */
export interface AdminUser {
  userId: string
  email: string
  status: string
  enabled: boolean
  role: UserRole
  createdAt: string
}

/** ユーザー詳細 */
export interface AdminUserDetail extends AdminUser {
  themeCount: number
  hasSettings: boolean
}

/** /admin/me レスポンス */
export interface MeResponse {
  userId: string
  role: UserRole
}

/** ユーザー一覧レスポンス */
export interface UsersListResponse {
  users: AdminUser[]
  nextToken: string | null
}

/** ユーザー詳細レスポンス */
export interface UserDetailResponse {
  user: AdminUserDetail
}
