import { useCallback, useState, useRef, useEffect } from 'react'
import { useAuthStore } from './authStore'
import { logout as authLogout } from './authClient'

interface UserMenuProps {
  onOpenProfile?: () => void
  onOpenSkills?: () => void
  onOpenSettings?: () => void
}

/**
 * ユーザーメニュー（アバター + ログアウト）
 * 認証済みの場合のみ表示
 */
export function UserMenu({ onOpenProfile, onOpenSkills, onOpenSettings }: UserMenuProps = {}) {
  const { status, user } = useAuthStore()
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const handleLogout = useCallback(async () => {
    setIsOpen(false)
    try {
      await authLogout()
    } catch (error) {
      console.error('[Auth] ログアウトエラー:', error)
    }
  }, [])

  // メニュー外クリックで閉じる
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  if (status !== 'authenticated' || !user) {
    return null
  }

  const initial = (user.displayName ?? user.email)?.[0]?.toUpperCase() ?? '?'

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        data-testid="user-menu-button"
        title={user.displayName ?? user.email}
      >
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={user.displayName ?? 'User'}
            className="w-7 h-7 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-medium">
            {initial}
          </div>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            {user.displayName && (
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {user.displayName}
              </p>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {user.email}
            </p>
          </div>
          <div className="py-1">
            {onOpenProfile && (
              <button
                onClick={() => {
                  setIsOpen(false)
                  onOpenProfile()
                }}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                data-testid="profile-menu-button"
              >
                プロフィール
              </button>
            )}
            {onOpenSkills && (
              <button
                onClick={() => {
                  setIsOpen(false)
                  onOpenSkills()
                }}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                data-testid="skills-menu-button"
              >
                スキル
              </button>
            )}
            {onOpenSettings && (
              <button
                onClick={() => {
                  setIsOpen(false)
                  onOpenSettings()
                }}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                data-testid="settings-menu-button"
              >
                設定
              </button>
            )}
            <button
              onClick={handleLogout}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              data-testid="logout-button"
            >
              ログアウト
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
