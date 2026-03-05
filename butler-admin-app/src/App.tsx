import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { AuthProvider } from '@/auth/AuthProvider'
import { AdminGuard } from '@/auth/AdminGuard'
import { useAuthStore } from '@/auth/authStore'
import { LoginPage } from '@/components/LoginPage'
import { AppLayout } from '@/components/AppLayout'
import { UserTable } from '@/components/UserTable'
import { UserDetail } from '@/components/UserDetail'

function AuthenticatedApp() {
  const status = useAuthStore((s) => s.status)

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">読み込み中...</div>
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return <LoginPage />
  }

  return (
    <AdminGuard>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/users" element={<UserTable />} />
          <Route path="/users/:userId" element={<UserDetail />} />
          <Route path="*" element={<Navigate to="/users" replace />} />
        </Route>
      </Routes>
    </AdminGuard>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AuthenticatedApp />
      </AuthProvider>
    </BrowserRouter>
  )
}
