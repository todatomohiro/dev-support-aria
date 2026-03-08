import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { searchService, type SearchResultItem } from '@/services/searchService'

type SearchTab = 'all' | 'topics' | 'memos'

/**
 * テキスト内の検索キーワードをハイライト表示
 */
function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-transparent text-blue-400 font-semibold">{part}</mark>
      : part
  )
}

/**
 * 日付を相対表示
 */
function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  if (isToday) return '今日'
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return '昨日'
  return date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }).replace('/', '月') + '日'
}

interface SearchModalProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * 全文検索モーダル（Cmd+K スタイル）
 */
export function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchTab, setSearchTab] = useState<SearchTab>('all')
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const resultsRef = useRef<HTMLDivElement>(null)

  /** モーダル表示時にフォーカス */
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('')
      setSearchResults([])
      setSearchTab('all')
      setFocusedIndex(0)
      setTimeout(() => searchInputRef.current?.focus(), 50)
    }
  }, [isOpen])

  /** Cmd+K / Ctrl+K でモーダルトグル */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (isOpen) {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  /** デバウンス付きバックエンド検索 */
  useEffect(() => {
    const q = searchQuery.trim()
    if (!q || q.length < 2) {
      setSearchResults([])
      setIsSearching(false)
      return
    }

    setIsSearching(true)
    clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(async () => {
      try {
        const result = await searchService.search(q)
        setSearchResults(result.items)
        setFocusedIndex(0)
      } catch (err) {
        console.error('検索エラー:', err)
      } finally {
        setIsSearching(false)
      }
    }, 400)

    return () => clearTimeout(searchTimerRef.current)
  }, [searchQuery])

  /** タブでフィルタされた検索結果 */
  const filteredResults = useMemo(() => {
    if (searchTab === 'all') return searchResults
    if (searchTab === 'topics') return searchResults.filter((r) => r.type === 'topic' || r.type === 'message')
    return searchResults.filter((r) => r.type === 'memo')
  }, [searchResults, searchTab])

  /** 検索結果のタイプ別カウント */
  const resultCounts = useMemo(() => ({
    all: searchResults.length,
    topics: searchResults.filter((r) => r.type === 'topic' || r.type === 'message').length,
    memos: searchResults.filter((r) => r.type === 'memo').length,
  }), [searchResults])

  /** 結果を選択して遷移 */
  const handleSelect = useCallback((item: SearchResultItem) => {
    if (item.type === 'topic' || item.type === 'message') {
      navigate(`/themes/${item.type === 'message' ? item.themeId! : item.id}`)
    }
    // メモの場合はメモ画面へ（将来拡張）
    onClose()
  }, [navigate, onClose])

  /** キーボードナビゲーション */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex((prev) => Math.min(prev + 1, filteredResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && filteredResults[focusedIndex]) {
      handleSelect(filteredResults[focusedIndex])
    }
  }, [onClose, filteredResults, focusedIndex, handleSelect])

  /** フォーカスアイテムのスクロール */
  useEffect(() => {
    const el = resultsRef.current?.children[focusedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [focusedIndex])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
      onClick={onClose}
    >
      {/* バックドロップ */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* モーダル本体 */}
      <div
        className="relative w-full max-w-[560px] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[60vh]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* 検索入力 */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-700">
          <svg className="w-5 h-5 text-gray-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="検索..."
            className="flex-1 bg-transparent border-none outline-none text-base text-gray-100 placeholder-gray-500"
            data-testid="search-modal-input"
          />
          <kbd className="px-1.5 py-0.5 text-[10px] text-gray-500 bg-gray-800 border border-gray-600 rounded">
            ESC
          </kbd>
        </div>

        {/* タブ */}
        {searchQuery.trim().length >= 2 && (
          <div className="flex border-b border-gray-700 px-4">
            {(['all', 'topics', 'memos'] as const).map((tab) => {
              const labels: Record<SearchTab, string> = { all: 'すべて', topics: 'トピック', memos: 'メモ' }
              const count = resultCounts[tab]
              return (
                <button
                  key={tab}
                  onClick={() => { setSearchTab(tab); setFocusedIndex(0) }}
                  className={`px-3.5 py-2 text-[13px] font-medium border-b-2 transition-colors ${
                    searchTab === tab
                      ? 'text-blue-400 border-blue-400'
                      : 'text-gray-500 border-transparent hover:text-gray-300'
                  }`}
                >
                  {labels[tab]}
                  {count > 0 && (
                    <span className={`ml-1.5 px-1.5 rounded-md text-[11px] ${
                      searchTab === tab
                        ? 'bg-blue-900/40 text-blue-300'
                        : 'bg-gray-800 text-gray-500'
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* 検索結果 */}
        <div ref={resultsRef} className="flex-1 overflow-y-auto">
          {searchQuery.trim().length < 2 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-600">
              <p className="text-sm">キーワードを入力して検索</p>
            </div>
          ) : isSearching ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="ml-2 text-sm text-gray-400">検索中...</span>
            </div>
          ) : filteredResults.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-600">
              <p className="text-sm">「{searchQuery}」に一致する結果はありません</p>
            </div>
          ) : (
            filteredResults.map((item, i) => (
              <button
                key={`${item.type}-${item.id}-${i}`}
                onClick={() => handleSelect(item)}
                className={`flex items-start gap-3 w-full px-4 py-3 text-left transition-colors ${
                  i === focusedIndex ? 'bg-gray-800' : 'hover:bg-gray-800/50'
                }`}
              >
                {/* アイコン */}
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                  item.type === 'memo'
                    ? 'bg-gray-800 text-yellow-400'
                    : 'bg-gray-800 text-gray-400'
                }`}>
                  {item.type === 'memo' ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  )}
                </div>
                {/* 本文 */}
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-gray-200">
                    {highlightText(item.title, searchQuery)}
                  </div>
                  {item.snippet && (
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                      {highlightText(item.snippet, searchQuery)}
                    </p>
                  )}
                </div>
                {/* 日付 */}
                <span className="text-[11px] text-gray-600 shrink-0 mt-1">
                  {formatRelativeDate(item.timestamp)}
                </span>
              </button>
            ))
          )}
        </div>

        {/* フッター */}
        {searchQuery.trim().length >= 2 && filteredResults.length > 0 && (
          <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-700 bg-gray-900/80">
            <span className="text-[11px] text-gray-500 flex items-center gap-1">
              <kbd className="px-1 py-0.5 text-[10px] bg-gray-800 border border-gray-600 rounded">↑</kbd>
              <kbd className="px-1 py-0.5 text-[10px] bg-gray-800 border border-gray-600 rounded">↓</kbd>
              移動
            </span>
            <span className="text-[11px] text-gray-500 flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 text-[10px] bg-gray-800 border border-gray-600 rounded">Enter</kbd>
              開く
            </span>
            <span className="text-[11px] text-gray-500 flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 text-[10px] bg-gray-800 border border-gray-600 rounded">ESC</kbd>
              閉じる
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
