import type { MeResponse, UsersListResponse, UserDetailResponse, UserRole, ModelMeta, ModelsListResponse } from '@/types/admin'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string

/** 認証ヘッダー付きfetch */
async function authFetch(path: string, token: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      ...options?.headers,
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export const adminApi = {
  /** 自分のロール取得 */
  async getMe(token: string): Promise<MeResponse> {
    return authFetch('/admin/me', token)
  },

  /** ユーザー一覧 */
  async listUsers(token: string, params?: { limit?: number; token?: string }): Promise<UsersListResponse> {
    const searchParams = new URLSearchParams()
    if (params?.limit) searchParams.set('limit', String(params.limit))
    if (params?.token) searchParams.set('token', params.token)
    const qs = searchParams.toString()
    return authFetch(`/admin/users${qs ? `?${qs}` : ''}`, token)
  },

  /** ユーザー詳細 */
  async getUserDetail(token: string, userId: string): Promise<UserDetailResponse> {
    return authFetch(`/admin/users/${userId}`, token)
  },

  /** ロール変更 */
  async updateRole(token: string, userId: string, role: UserRole): Promise<{ userId: string; role: UserRole }> {
    return authFetch(`/admin/users/${userId}/role`, token, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    })
  },

  // ── Models ──

  /** モデル一覧 */
  async listModels(token: string): Promise<ModelsListResponse> {
    return authFetch('/admin/models', token)
  },

  /** モデルアップロード */
  async uploadModel(token: string, data: { name: string; description?: string; files: Record<string, string> }): Promise<ModelMeta> {
    return authFetch('/admin/models', token, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /** モデル更新（マッピング・ステータス等） */
  async updateModel(token: string, modelId: string, data: Partial<Pick<ModelMeta, 'name' | 'description' | 'status' | 'emotionMapping' | 'motionMapping'>>): Promise<{ modelId: string; updated: boolean }> {
    return authFetch(`/admin/models/${modelId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  },

  /** モデル削除 */
  async deleteModel(token: string, modelId: string): Promise<{ modelId: string; deleted: boolean }> {
    return authFetch(`/admin/models/${modelId}`, token, {
      method: 'DELETE',
    })
  },
}
