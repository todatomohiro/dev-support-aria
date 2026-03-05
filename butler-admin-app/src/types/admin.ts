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

// ── Models ──

/** モデル表情定義 */
export interface ModelExpression {
  name: string
  file: string
}

/** モデルモーション定義 */
export interface ModelMotion {
  group: string
  index: number
  file: string
}

/** モデルメタデータ */
export interface ModelMeta {
  modelId: string
  name: string
  description: string
  s3Prefix: string
  modelFile: string
  status: 'active' | 'inactive'
  expressions: ModelExpression[]
  motions: ModelMotion[]
  emotionMapping: Record<string, string>
  motionMapping: Record<string, { group: string; index: number }>
  createdAt: string
  updatedAt: string
}

/** モデル一覧レスポンス */
export interface ModelsListResponse {
  models: ModelMeta[]
}
