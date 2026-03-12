import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useAuthStore } from '@/auth/authStore'
import { useAdminStore } from '@/stores/adminStore'
import { adminApi } from '@/services/adminApi'
import { RoleBadge } from './RoleBadge'
import { ConfirmDialog } from './ConfirmDialog'
import type { UserRole, UserPlan } from '@/types/admin'

/** ユーザー詳細画面 */
export function UserDetail() {
  const { userId } = useParams<{ userId: string }>()
  const navigate = useNavigate()
  const idToken = useAuthStore((s) => s.idToken)
  const currentUserId = useAuthStore((s) => s.user?.userId)
  const { selectedUser, loading, error, setSelectedUser, updateUserRole, updateUserPlan, setLoading, setError } = useAdminStore()
  const [confirmRole, setConfirmRole] = useState<UserRole | null>(null)
  const [confirmPlan, setConfirmPlan] = useState<UserPlan | null>(null)

  const fetchDetail = useCallback(async () => {
    if (!idToken || !userId) return
    setLoading(true)
    setError(null)
    try {
      const result = await adminApi.getUserDetail(idToken, userId)
      setSelectedUser(result.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ユーザー詳細の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [idToken, userId, setSelectedUser, setLoading, setError])

  useEffect(() => {
    fetchDetail()
    return () => setSelectedUser(null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRoleChange = async () => {
    if (!idToken || !userId || !confirmRole) return
    setError(null)
    try {
      await adminApi.updateRole(idToken, userId, confirmRole)
      updateUserRole(userId, confirmRole)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ロール変更に失敗しました')
    } finally {
      setConfirmRole(null)
    }
  }

  const handlePlanChange = async () => {
    if (!idToken || !userId || !confirmPlan) return
    setError(null)
    try {
      await adminApi.updatePlan(idToken, userId, confirmPlan)
      updateUserPlan(userId, confirmPlan)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'プラン変更に失敗しました')
    } finally {
      setConfirmPlan(null)
    }
  }

  if (loading && !selectedUser) {
    return <div className="text-gray-400">読み込み中...</div>
  }

  if (!selectedUser) {
    return <div className="text-gray-400">{error ?? 'ユーザーが見つかりません'}</div>
  }

  const isSelf = currentUserId === selectedUser.userId
  const newRole: UserRole = selectedUser.role === 'admin' ? 'user' : 'admin'
  const currentPlan: UserPlan = selectedUser.plan ?? 'free'
  const newPlan: UserPlan = currentPlan === 'paid' ? 'free' : 'paid'

  return (
    <div>
      <button
        onClick={() => navigate('/users')}
        className="text-sm text-blue-600 hover:text-blue-800 mb-4 cursor-pointer"
      >
        ← ユーザー一覧に戻る
      </button>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">{selectedUser.email}</h2>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              currentPlan === 'paid'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-gray-100 text-gray-600'
            }`}>
              {currentPlan === 'paid' ? 'Premium' : 'Free'}
            </span>
            <RoleBadge role={selectedUser.role} />
          </div>
        </div>

        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-gray-500">User ID</dt>
            <dd className="font-mono text-xs mt-1 break-all">{selectedUser.userId}</dd>
          </div>
          <div>
            <dt className="text-gray-500">ステータス</dt>
            <dd className="mt-1">{selectedUser.status}</dd>
          </div>
          <div>
            <dt className="text-gray-500">作成日</dt>
            <dd className="mt-1">
              {selectedUser.createdAt ? new Date(selectedUser.createdAt).toLocaleString('ja-JP') : '-'}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">有効</dt>
            <dd className="mt-1">{selectedUser.enabled ? 'はい' : 'いいえ'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">トピック数</dt>
            <dd className="mt-1">{selectedUser.themeCount}</dd>
          </div>
          <div>
            <dt className="text-gray-500">設定</dt>
            <dd className="mt-1">{selectedUser.hasSettings ? 'あり' : 'なし'}</dd>
          </div>
        </dl>

        <div className="mt-6 pt-6 border-t border-gray-200">
          <h3 className="font-medium mb-3">データ</h3>
          <div className="flex gap-3">
            <button
              onClick={() => navigate(`/users/${userId}/memory`)}
              className="px-4 py-2 text-sm rounded cursor-pointer bg-purple-50 text-purple-700 hover:bg-purple-100"
            >
              永久記憶を表示
            </button>
            <button
              onClick={() => navigate(`/users/${userId}/activity`)}
              className="px-4 py-2 text-sm rounded cursor-pointer bg-blue-50 text-blue-700 hover:bg-blue-100"
            >
              アクティビティログを表示
            </button>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-gray-200">
          <h3 className="font-medium mb-3">プラン管理</h3>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              現在のプラン: <span className="font-medium">{currentPlan === 'paid' ? 'Premium（有料）' : 'Free（無料）'}</span>
            </span>
            <button
              onClick={() => setConfirmPlan(newPlan)}
              className={`px-4 py-2 text-sm rounded cursor-pointer ${
                newPlan === 'paid'
                  ? 'bg-amber-500 text-white hover:bg-amber-600'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              {newPlan === 'paid' ? 'Premium に変更' : 'Free に変更'}
            </button>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-gray-200">
          <h3 className="font-medium mb-3">ロール管理</h3>
          {isSelf ? (
            <p className="text-sm text-gray-500">自分のロールは変更できません</p>
          ) : (
            <button
              onClick={() => setConfirmRole(newRole)}
              className={`px-4 py-2 text-sm rounded cursor-pointer ${
                newRole === 'admin'
                  ? 'bg-purple-600 text-white hover:bg-purple-700'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              {newRole === 'admin' ? 'Admin に昇格' : 'User に降格'}
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmRole !== null}
        title="ロール変更の確認"
        message={`${selectedUser.email} のロールを「${confirmRole}」に変更しますか？`}
        confirmLabel="変更する"
        onConfirm={handleRoleChange}
        onCancel={() => setConfirmRole(null)}
      />

      <ConfirmDialog
        open={confirmPlan !== null}
        title="プラン変更の確認"
        message={`${selectedUser.email} のプランを「${confirmPlan === 'paid' ? 'Premium（有料）' : 'Free（無料）'}」に変更しますか？`}
        confirmLabel="変更する"
        onConfirm={handlePlanChange}
        onCancel={() => setConfirmPlan(null)}
      />
    </div>
  )
}
