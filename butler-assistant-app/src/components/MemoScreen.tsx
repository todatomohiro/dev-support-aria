import { useState, useEffect, useCallback } from 'react'
import { memoService } from '@/services/memoService'
import type { Memo } from '@/services/memoService'

/**
 * メモ一覧画面コンポーネント
 */
export function MemoScreen() {
  const [memos, setMemos] = useState<Memo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  /**
   * メモ一覧を取得
   */
  const loadMemos = useCallback(async (query?: string) => {
    setIsLoading(true)
    try {
      const result = await memoService.listMemos(query)
      setMemos(result.memos)
    } catch (error) {
      console.error('[MemoScreen] メモ取得エラー:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadMemos()
  }, [loadMemos])

  /**
   * 検索実行
   */
  const handleSearch = useCallback(() => {
    loadMemos(searchQuery || undefined)
  }, [searchQuery, loadMemos])

  /**
   * メモ削除
   */
  const handleDelete = useCallback(async (memoId: string) => {
    setDeletingId(memoId)
    try {
      await memoService.deleteMemo(memoId)
      setMemos((prev) => prev.filter((m) => m.memoId !== memoId))
    } catch (error) {
      console.error('[MemoScreen] メモ削除エラー:', error)
    } finally {
      setDeletingId(null)
    }
  }, [])

  /**
   * 日時をフォーマット
   */
  const formatDate = (iso: string) => {
    const d = new Date(iso)
    const month = d.getMonth() + 1
    const day = d.getDate()
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    return `${month}/${day} ${hours}:${minutes}`
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900" data-testid="memo-screen">
      {/* ヘッダー */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
          メモ
        </h2>
        {/* 検索バー */}
        <div className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="メモを検索..."
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            data-testid="memo-search-input"
          />
          <button
            onClick={handleSearch}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            data-testid="memo-search-button"
          >
            検索
          </button>
        </div>
      </div>

      {/* メモ一覧 */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : memos.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            <p className="text-sm">メモはまだありません</p>
            <p className="text-xs mt-1">メッセージのブックマークアイコンから保存できます</p>
          </div>
        ) : (
          <div className="space-y-3">
            {memos.map((memo) => (
              <div
                key={memo.memoId}
                className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50"
                data-testid={`memo-item-${memo.memoId}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {memo.title}
                    </h3>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-3 whitespace-pre-wrap">
                      {memo.content}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[10px] text-gray-400">
                        {formatDate(memo.createdAt)}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                        {memo.source === 'chat' ? 'AI' : 'クイック'}
                      </span>
                      {memo.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(memo.memoId)}
                    disabled={deletingId === memo.memoId}
                    className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500 transition-colors shrink-0"
                    title="削除"
                    data-testid={`memo-delete-${memo.memoId}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
