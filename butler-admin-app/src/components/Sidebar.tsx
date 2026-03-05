import { NavLink } from 'react-router'
import { useAuthStore } from '@/auth/authStore'
import { logout } from '@/auth/authClient'

/** サイドバー */
export function Sidebar() {
  const user = useAuthStore((s) => s.user)
  const mfaEnabled = useAuthStore((s) => s.mfaEnabled)

  return (
    <aside className="w-60 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <h1 className="text-lg font-bold">Butler Admin</h1>
      </div>

      <nav className="flex-1 p-2">
        {mfaEnabled && (
          <NavLink
            to="/users"
            className={({ isActive }) =>
              `block px-3 py-2 rounded text-sm ${isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-100'}`
            }
          >
            ユーザー管理
          </NavLink>
        )}
        <NavLink
          to="/mfa"
          className={({ isActive }) =>
            `block px-3 py-2 rounded text-sm ${isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-100'}`
          }
        >
          MFA 設定
        </NavLink>
      </nav>

      <div className="p-4 border-t border-gray-200">
        <div className="text-xs text-gray-500 mb-2 truncate">{user?.email}</div>
        <button
          onClick={() => logout()}
          className="text-sm text-gray-600 hover:text-gray-900 cursor-pointer"
        >
          ログアウト
        </button>
      </div>
    </aside>
  )
}
