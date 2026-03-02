import { useState, useCallback } from 'react'
import { useLocation } from 'react-router'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'

interface AppLayoutProps {
  children: React.ReactNode
  currentSessionName?: string
  onOpenSettings: () => void
  headerRight?: React.ReactNode
}

/**
 * レスポンシブレイアウトラッパー
 *
 * PC: サイドバー + コンテンツ
 * スマホ: コンテンツ + ボトムナビ
 */
export function AppLayout({ children, currentSessionName, onOpenSettings, headerRight }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const location = useLocation()

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev)
  }, [])

  // 現在のアクティブタブを判定
  const activeTab = location.pathname.startsWith('/themes')
    ? 'themes'
    : location.pathname.startsWith('/groups')
      ? 'groups'
      : 'chat'

  return (
    <div className="h-screen flex flex-col bg-gray-100 dark:bg-gray-900">
      {/* ヘッダー */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 shrink-0 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between px-2 sm:px-4 py-2 sm:py-3 pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]">
          <div className="flex items-center gap-1 sm:gap-2">
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
            <h1 className="text-base sm:text-xl font-semibold text-gray-900 dark:text-gray-100 truncate">
              {currentSessionName ?? 'AI Assistant'}
            </h1>
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
