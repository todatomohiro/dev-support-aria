import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useAuthStore } from '@/auth/authStore'
import { adminApi } from '@/services/adminApi'
import { ConfirmDialog } from './ConfirmDialog'

type Category = 'facts' | 'preferences'

interface MemoryData {
  facts: string[]
  preferences: string[]
  lastUpdatedAt: string | null
}

/** 永久記憶閲覧・削除画面 */
export function UserMemoryViewer() {
  const { userId } = useParams<{ userId: string }>()
  const navigate = useNavigate()
  const idToken = useAuthStore((s) => s.idToken)

  const [data, setData] = useState<MemoryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ category: Category; index: number; text: string } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchData = useCallback(async () => {
    if (!idToken || !userId) return
    setLoading(true)
    setError(null)
    try {
      const result = await adminApi.getUserMemory(idToken, userId)
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : '永久記憶の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [idToken, userId])

  useEffect(() => {
    fetchData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async () => {
    if (!idToken || !userId || !deleteTarget) return
    setDeleting(true)
    try {
      await adminApi.deleteUserMemoryItem(idToken, userId, deleteTarget.category, deleteTarget.index)
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました')
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  return (
    <div>
      <button
        onClick={() => navigate(`/users/${userId}`)}
        className="text-sm text-blue-600 hover:text-blue-800 mb-4 cursor-pointer"
      >
        &larr; ユーザー詳細に戻る
      </button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">永久記憶</h2>
          <p className="text-sm text-gray-500 mt-1">
            FACTS（客観的事実）と PREFERENCES（対話設定）
          </p>
        </div>
        {data?.lastUpdatedAt && (
          <span className="text-xs text-gray-400">
            最終更新: {new Date(data.lastUpdatedAt).toLocaleString('ja-JP')}
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
      {loading && <p className="text-gray-400 mb-4">読み込み中...</p>}

      {!loading && data && (
        <div className="space-y-6">
          {/* FACTS セクション */}
          <MemorySection
            title="FACTS（客観的事実）"
            description={`${data.facts.length} / 40 件（統合閾値: 30件）`}
            items={data.facts}
            category="facts"
            onDelete={(index, text) => setDeleteTarget({ category: 'facts', index, text })}
            badgeColor="bg-blue-100 text-blue-700"
          />

          {/* PREFERENCES セクション */}
          <MemorySection
            title="PREFERENCES（対話設定）"
            description={`${data.preferences.length} / 15 件（統合閾値: 12件）`}
            items={data.preferences}
            category="preferences"
            onDelete={(index, text) => setDeleteTarget({ category: 'preferences', index, text })}
            badgeColor="bg-purple-100 text-purple-700"
          />
        </div>
      )}

      {!loading && data && data.facts.length === 0 && data.preferences.length === 0 && (
        <div className="bg-white rounded-lg shadow p-6 text-center text-gray-400">
          永久記憶データがありません
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="永久記憶の項目を削除"
        message={`以下の項目を削除しますか？\n\n「${deleteTarget?.text ?? ''}」\n\n※ この操作は元に戻せません`}
        confirmLabel={deleting ? '削除中...' : '削除する'}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

/** カテゴリごとのセクション */
function MemorySection({
  title,
  description,
  items,
  category,
  onDelete,
  badgeColor,
}: {
  title: string
  description: string
  items: string[]
  category: Category
  onDelete: (index: number, text: string) => void
  badgeColor: string
}) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <p className="text-xs text-gray-400 mt-1">{description}</p>
        </div>
        <span className={`px-2 py-0.5 text-xs rounded font-medium ${badgeColor}`}>
          {items.length}件
        </span>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-gray-400 py-2">データなし</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {items.map((item, index) => (
            <div
              key={`${category}-${index}`}
              className="flex items-center justify-between py-2.5 group"
            >
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <span className="text-xs text-gray-300 mt-0.5 w-6 text-right shrink-0">
                  {index + 1}
                </span>
                <span className="text-sm text-gray-700 break-all">{item}</span>
              </div>
              <button
                onClick={() => onDelete(index, item)}
                className="ml-3 p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 cursor-pointer"
                title="削除"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
