import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { AuthProvider } from '@/auth/AuthProvider'
import { AdminGuard } from '@/auth/AdminGuard'
import { useAuthStore } from '@/auth/authStore'
import { LoginPage } from '@/components/LoginPage'
import { AppLayout } from '@/components/AppLayout'
import { UserTable } from '@/components/UserTable'
import { UserDetail } from '@/components/UserDetail'
import { MfaSettingsPage } from '@/components/MfaSettingsPage'
import { ModelManagement } from '@/components/ModelManagement'
import { ModelMappingEditor } from '@/components/ModelMappingEditor'
import { ModelCharacterEditor } from '@/components/ModelCharacterEditor'
import { UserActivityViewer } from '@/components/UserActivityViewer'
import { UserMemoryViewer } from '@/components/UserMemoryViewer'

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
      <AppRoutes />
    </AdminGuard>
  )
}

/** MFA 有効状態に応じてルーティングを制御 */
function AppRoutes() {
  const mfaEnabled = useAuthStore((s) => s.mfaEnabled)

  if (!mfaEnabled) {
    // MFA 未設定: MFA 設定ページのみアクセス可能
    return (
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/mfa" element={<MfaSettingsPage />} />
          <Route path="*" element={<Navigate to="/mfa" replace />} />
        </Route>
      </Routes>
    )
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/users" element={<UserTable />} />
        <Route path="/users/:userId" element={<UserDetail />} />
        <Route path="/users/:userId/activity" element={<UserActivityViewer />} />
        <Route path="/users/:userId/memory" element={<UserMemoryViewer />} />
        <Route path="/models" element={<ModelManagement />} />
        <Route path="/models/:modelId/mapping" element={<ModelMappingEditor />} />
        <Route path="/models/:modelId/character" element={<ModelCharacterEditor />} />
        <Route path="/mfa" element={<MfaSettingsPage />} />
        <Route path="*" element={<Navigate to="/users" replace />} />
      </Route>
    </Routes>
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
