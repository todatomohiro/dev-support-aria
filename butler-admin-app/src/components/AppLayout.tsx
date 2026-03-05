import { Outlet } from 'react-router'
import { Sidebar } from './Sidebar'

/** アプリレイアウト（サイドバー + メインコンテンツ） */
export function AppLayout() {
  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
