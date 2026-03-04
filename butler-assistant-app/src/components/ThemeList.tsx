import { useCallback, useMemo, useState } from 'react'
import type { ThemeSession } from '@/types'
import { WorkBadge } from './WorkBadge'

interface ThemeListProps {
  themes: ThemeSession[]
  onSelectTheme: (themeId: string) => void
  onCreate: () => Promise<void>
  onDelete: (themeId: string) => Promise<void>
  isLoading: boolean
  error: string | null
}

/**
 * テーマ一覧画面
 */
export function ThemeList({ themes, onSelectTheme, onCreate, onDelete, isLoading, error }: ThemeListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  /** 検索クエリでフィルタリングされたテーマ一覧 */
  const filteredThemes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return themes
    return themes.filter((t) => t.themeName.toLowerCase().includes(q))
  }, [themes, searchQuery])

  const handleDelete = useCallback(async (e: React.MouseEvent, themeId: string) => {
    e.stopPropagation()
    if (!confirm('このトピックを削除しますか？')) return
    setDeletingId(themeId)
    try {
      await onDelete(themeId)
    } finally {
      setDeletingId(null)
    }
  }, [onDelete])

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="flex flex-col h-full" data-testid="theme-list">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">トピック</h2>
        <button
          onClick={() => onCreate()}
          className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          data-testid="create-theme-button"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          新規トピックを始める
        </button>
      </div>

      {/* 検索バー（テーマが2件以上ある場合のみ表示） */}
      {themes.length >= 2 && (
        <div className="px-4 pt-3 shrink-0">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="トピックを検索..."
              className="w-full pl-9 pr-8 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              data-testid="theme-search-input"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                data-testid="theme-search-clear"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* コンテンツ */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-12 text-red-500" data-testid="theme-list-error">{error}</div>
        ) : themes.length === 0 ? (
          <div className="text-center py-12">
            <svg className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-gray-500 dark:text-gray-400 mb-2">トピックがありません</p>
            <p className="text-sm text-gray-400 dark:text-gray-500">「新規トピックを始める」ボタンでトピックを作成しましょう</p>
          </div>
        ) : filteredThemes.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400">「{searchQuery}」に一致するトピックはありません</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredThemes.map((theme) => (
              <button
                key={theme.themeId}
                onClick={() => onSelectTheme(theme.themeId)}
                className="flex flex-col p-4 text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-sm transition-all group"
                data-testid={`theme-card-${theme.themeId}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {theme.themeName}
                    </h3>
                    {theme.workActive && theme.workExpiresAt && (
                      <WorkBadge active expiresAt={theme.workExpiresAt} compact />
                    )}
                  </div>
                  <button
                    onClick={(e) => handleDelete(e, theme.themeId)}
                    disabled={deletingId === theme.themeId}
                    className="p-1 text-gray-400 hover:text-red-500 transition-colors shrink-0"
                    title="削除"
                    data-testid={`theme-delete-${theme.themeId}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
                <span className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                  {formatDate(theme.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
