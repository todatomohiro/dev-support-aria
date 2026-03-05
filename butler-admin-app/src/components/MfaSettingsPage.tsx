import { useState, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { checkMfaEnabled, setupTotp, verifyAndEnableTotp } from '@/auth/authClient'
import { useAuthStore } from '@/auth/authStore'

type PageState = 'loading' | 'enabled' | 'disabled' | 'setup' | 'verify'

/** MFA 設定ページ */
export function MfaSettingsPage() {
  const user = useAuthStore((s) => s.user)
  const setMfaEnabled = useAuthStore((s) => s.setMfaEnabled)
  const [state, setState] = useState<PageState>('loading')
  const [qrCodeUri, setQrCodeUri] = useState('')
  const [sharedSecret, setSharedSecret] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    checkMfaEnabled()
      .then((enabled) => setState(enabled ? 'enabled' : 'disabled'))
      .catch(() => setState('disabled'))
  }, [])

  /** TOTP セットアップ開始 */
  const startSetup = async () => {
    setError(null)
    setState('setup')
    try {
      const result = await setupTotp(user?.email ?? '')
      setQrCodeUri(result.qrCodeUri)
      setSharedSecret(result.sharedSecret)
      setState('verify')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'セットアップに失敗しました')
      setState('disabled')
    }
  }

  /** TOTP 検証 + 有効化 */
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await verifyAndEnableTotp(code)
      setCode('')
      setQrCodeUri('')
      setSharedSecret('')
      setMfaEnabled(true)
      setState('enabled')
    } catch (err) {
      setError(err instanceof Error ? err.message : '認証コードが正しくありません')
    } finally {
      setLoading(false)
    }
  }

  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">読み込み中...</div>
      </div>
    )
  }

  return (
    <div className="max-w-lg">
      <h2 className="text-xl font-bold mb-6">二要素認証（MFA）設定</h2>

      {/* 有効状態 */}
      {state === 'enabled' && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span className="font-medium text-green-700">TOTP 認証が有効です</span>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            ログイン時に認証アプリのコードが必要です。
          </p>
          <button
            onClick={startSetup}
            className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50 cursor-pointer"
          >
            認証アプリを再設定する
          </button>
        </div>
      )}

      {/* 無効状態 */}
      {state === 'disabled' && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <span className="font-medium text-red-700">TOTP 認証が未設定です</span>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            管理画面へのアクセスには二要素認証の設定が必要です。<br />
            Google Authenticator 等の認証アプリをご用意ください。
          </p>
          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
          <button
            onClick={startSetup}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 cursor-pointer"
          >
            TOTP 認証を設定する
          </button>
        </div>
      )}

      {/* セットアップ中 */}
      {state === 'setup' && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="text-gray-500">セットアップを準備中...</div>
        </div>
      )}

      {/* QR コード + 検証 */}
      {state === 'verify' && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="font-medium mb-4">認証アプリで QR コードをスキャン</h3>

          <div className="flex justify-center mb-4">
            {qrCodeUri && <QRCodeSVG value={qrCodeUri} size={180} />}
          </div>

          <details className="mb-6">
            <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700">
              QR コードをスキャンできない場合
            </summary>
            <div className="mt-2 p-3 bg-gray-50 rounded">
              <p className="text-xs text-gray-500 mb-1">以下のキーを認証アプリに手動入力：</p>
              <code className="text-sm font-mono break-all select-all">{sharedSecret}</code>
            </div>
          </details>

          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <label htmlFor="mfa-code" className="block text-sm font-medium text-gray-700 mb-1">
                認証コード（6桁）
              </label>
              <input
                id="mfa-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                required
                autoFocus
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-center text-2xl tracking-widest"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setState('disabled'); setCode(''); setError(null) }}
                className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50 cursor-pointer"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="flex-1 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
              >
                {loading ? '確認中...' : '設定を完了する'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
