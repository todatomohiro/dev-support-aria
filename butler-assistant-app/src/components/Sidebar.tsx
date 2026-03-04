import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useThemeStore } from '@/stores/themeStore'
import { themeService } from '@/services'

interface SidebarProps {
  activeTab: string
  onOpenSettings: () => void
  onOpenWork: () => void
}

/**
 * PC 版サイドバー
 */
export function Sidebar({ activeTab, onOpenSettings, onOpenWork }: SidebarProps) {
  const navigate = useNavigate()
  const themes = useThemeStore((s) => s.themes)
  const activeThemeId = useThemeStore((s) => s.activeThemeId)
  const setThemes = useThemeStore((s) => s.setThemes)

  /** マウント時にトピック一覧を取得 */
  useEffect(() => {
    themeService.listThemes().then(setThemes).catch(() => {})
  }, [setThemes])

  return (
    <div className="h-full w-[260px] flex flex-col bg-white dark:bg-gray-800" data-testid="sidebar">
      {/* メイン会話 */}
      <button
        onClick={() => navigate('/')}
        className={`flex items-center gap-2 px-4 py-3 text-left text-sm font-medium transition-colors ${
          activeTab === 'chat'
            ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
        }`}
        data-testid="sidebar-main-chat"
      >
        <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        AIチャット
      </button>

      {/* テーマ別ノートセクション */}
      <div className="flex-1 min-h-0 border-t border-gray-200 dark:border-gray-700 flex flex-col">
        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            トピック
          </span>
          <button
            onClick={() => navigate('/themes')}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            data-testid="sidebar-themes-link"
          >
            一覧へ
          </button>
        </div>

        {/* テーマ一覧（直近5件） */}
        <div className="flex-1 overflow-y-auto">
          {themes.slice(0, 5).map((theme) => {
            const isActive = activeTab === 'themes' && activeThemeId === theme.themeId
            return (
            <button
              key={theme.themeId}
              onClick={() => navigate(`/themes/${theme.themeId}`)}
              className={`w-full flex items-center gap-2 px-4 py-2 text-left text-sm transition-colors ${
                isActive
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <svg className="w-4 h-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="truncate">{theme.themeName}</span>
              {theme.workActive && (
                <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" title="ワーク接続中" />
              )}
            </button>
            )
          })}
        </div>
      </div>

      {/* ワーク */}
      <div className="border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={onOpenWork}
          className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          data-testid="sidebar-work"
        >
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          ワーク
        </button>
      </div>

      {/* 設定 */}
      <div className="border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          data-testid="sidebar-settings"
        >
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          設定
        </button>
      </div>
    </div>
  )
}
