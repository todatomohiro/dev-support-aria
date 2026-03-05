import { useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { useAuthStore } from '@/auth/authStore'
import { useAdminStore } from '@/stores/adminStore'
import { adminApi } from '@/services/adminApi'
import { RoleBadge } from './RoleBadge'

/** ユーザー一覧テーブル */
export function UserTable() {
  const navigate = useNavigate()
  const idToken = useAuthStore((s) => s.idToken)
  const { users, nextToken, loading, error, setUsers, appendUsers, setLoading, setError } = useAdminStore()

  const fetchUsers = useCallback(async (append = false) => {
    if (!idToken) return
    setLoading(true)
    setError(null)
    try {
      const token = append ? (nextToken ?? undefined) : undefined
      const result = await adminApi.listUsers(idToken, { limit: 20, token })
      if (append) {
        appendUsers(result.users, result.nextToken)
      } else {
        setUsers(result.users, result.nextToken)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ユーザー取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [idToken, nextToken, setUsers, appendUsers, setLoading, setError])

  useEffect(() => {
    fetchUsers()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">ユーザー管理</h2>
        <button
          onClick={() => fetchUsers()}
          disabled={loading}
          className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
        >
          更新
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">メール</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">ステータス</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">ロール</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">作成日</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((user) => (
              <tr
                key={user.userId}
                onClick={() => navigate(`/users/${user.userId}`)}
                className="hover:bg-gray-50 cursor-pointer"
              >
                <td className="px-4 py-3">{user.email}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs ${user.enabled ? 'text-green-600' : 'text-gray-400'}`}>
                    {user.status}
                  </span>
                </td>
                <td className="px-4 py-3"><RoleBadge role={user.role} /></td>
                <td className="px-4 py-3 text-gray-500">
                  {user.createdAt ? new Date(user.createdAt).toLocaleDateString('ja-JP') : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {users.length === 0 && !loading && (
          <div className="text-center text-gray-400 py-8">ユーザーがいません</div>
        )}

        {loading && (
          <div className="text-center text-gray-400 py-4">読み込み中...</div>
        )}
      </div>

      {nextToken && !loading && (
        <div className="mt-4 text-center">
          <button
            onClick={() => fetchUsers(true)}
            className="px-4 py-2 text-sm text-blue-600 hover:text-blue-800 cursor-pointer"
          >
            もっと読み込む
          </button>
        </div>
      )}
    </div>
  )
}
