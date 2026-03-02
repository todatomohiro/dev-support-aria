import { useState, useCallback, useRef, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'

interface AppLayoutProps {
  children: React.ReactNode
  currentSessionName?: string
  onOpenSettings: () => void
  headerRight?: React.ReactNode
  /** ヘッダーのセッション名を編集可能にするコールバック */
  onRenameSession?: (newName: string) => void
}

/**
 * レスポンシブレイアウトラッパー
 *
 * PC: サイドバー + コンテンツ
 * スマホ: コンテンツ + ボトムナビ
 */
export function AppLayout({ children, currentSessionName, onOpenSettings, headerRight, onRenameSession }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const location = useLocation()
  const navigate = useNavigate()

  // スマホ用: トピックチャット時に戻るボタンを表示
  const showMobileBack = location.pathname.startsWith('/themes/') && location.pathname !== '/themes'

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev)
  }, [])

  // 現在のアクティブタブを判定
  const activeTab = location.pathname.startsWith('/themes')
    ? 'themes'
    : location.pathname.startsWith('/groups')
      ? 'groups'
      : 'chat'

  /** 編集開始 */
  const handleStartEdit = useCallback(() => {
    if (!onRenameSession) return
    setEditValue(currentSessionName ?? '')
    setIsEditing(true)
  }, [onRenameSession, currentSessionName])

  /** 編集確定 */
  const handleConfirmEdit = useCallback(() => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== currentSessionName) {
      onRenameSession?.(trimmed)
    }
    setIsEditing(false)
  }, [editValue, currentSessionName, onRenameSession])

  /** 編集キャンセル */
  const handleCancelEdit = useCallback(() => {
    setIsEditing(false)
  }, [])

  /** キーボード操作 */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleConfirmEdit()
    } else if (e.key === 'Escape') {
      handleCancelEdit()
    }
  }, [handleConfirmEdit, handleCancelEdit])

  // 編集モード開始時にフォーカス
  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [isEditing])

  return (
    <div className="h-screen flex flex-col bg-gray-100 dark:bg-gray-900">
      {/* ヘッダー */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 shrink-0 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between px-2 sm:px-4 py-2 sm:py-3 pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]">
          <div className="flex items-center gap-1 sm:gap-2 min-w-0 flex-1">
            {/* スマホ: トピックチャットの戻るボタン */}
            {showMobileBack && (
              <button
                onClick={() => navigate('/themes')}
                className="md:hidden p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
                data-testid="theme-chat-back"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            {/* PC: サイドバートグル */}
            <button
              onClick={toggleSidebar}
              className="hidden md:flex p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
              title="サイドバー切り替え"
              data-testid="sidebar-toggle"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleConfirmEdit}
                onKeyDown={handleKeyDown}
                className="text-base sm:text-xl font-semibold text-gray-900 dark:text-gray-100 bg-transparent border-b-2 border-blue-500 outline-none min-w-0 flex-1"
                data-testid="session-name-input"
              />
            ) : (
              <h1
                className={`text-base sm:text-xl font-semibold text-gray-900 dark:text-gray-100 truncate ${onRenameSession ? 'cursor-pointer hover:text-blue-600 dark:hover:text-blue-400' : ''}`}
                onClick={onRenameSession ? handleStartEdit : undefined}
                title={onRenameSession ? 'クリックして名前を編集' : undefined}
                data-testid="session-name"
              >
                {currentSessionName ?? 'AI Assistant'}
              </h1>
            )}
            {onRenameSession && !isEditing && (
              <button
                onClick={handleStartEdit}
                className="shrink-0 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                title="名前を編集"
                data-testid="session-name-edit"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            )}
          </div>
          {headerRight && (
            <nav className="flex items-center gap-1 sm:gap-2">
              {headerRight}
            </nav>
          )}
        </div>
      </header>

      {/* メインコンテンツ */}
      <div className="flex-1 flex overflow-hidden">
        {/* PC: サイドバー */}
        <div
          className={`hidden md:block transition-all duration-200 ease-in-out overflow-hidden border-r border-gray-200 dark:border-gray-700 ${
            sidebarOpen ? 'w-[260px]' : 'w-0 border-r-0'
          }`}
        >
          <Sidebar
            activeTab={activeTab}
            onOpenSettings={onOpenSettings}
          />
        </div>

        {/* コンテンツエリア */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {children}
        </main>
      </div>

      {/* スマホ: ボトムナビ */}
      <div className="md:hidden">
        <BottomNav activeTab={activeTab} onOpenSettings={onOpenSettings} />
      </div>
    </div>
  )
}
