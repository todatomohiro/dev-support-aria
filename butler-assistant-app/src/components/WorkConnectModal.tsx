import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { useQRScanner } from '@/hooks/useQRScanner'
import { workService } from '@/services/workService'
import { useThemeStore } from '@/stores/themeStore'
import { isRegistryCode, normalizeRegistryCode } from '@/utils/registryCode'
import type { MCPQRPayload } from '@/types/work'

interface WorkConnectModalProps {
  isOpen: boolean
  onClose: () => void
}

/** タブの種類 */
type TabId = 'qr' | 'code'

/**
 * ワーク（MCP）接続モーダル
 *
 * QRコード読み取り / ワークコード入力 / URL直接入力で MCP サーバーに接続し、
 * 新規トピックを作成してナビゲートする。
 */
export function WorkConnectModal({ isOpen, onClose }: WorkConnectModalProps) {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<TabId>('code')
  const [codeInput, setCodeInput] = useState('')
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scanner = useQRScanner()

  /** QRコードデータまたはURL文字列からペイロードをパース */
  const parsePayload = useCallback((raw: string): MCPQRPayload | null => {
    // JSON 形式の場合（QRコード）
    try {
      const parsed = JSON.parse(raw)
      if (parsed.type === 'mcp' && (parsed.serverUrl || parsed.code)) {
        return {
          type: 'mcp',
          code: parsed.code,
          serverUrl: parsed.serverUrl,
          ttlMinutes: parsed.ttlMinutes ?? 30,
          metadata: parsed.metadata,
        }
      }
    } catch {
      // JSON でない場合はコードまたは URL として扱う
    }

    // レジストリコード形式
    if (isRegistryCode(raw.trim())) {
      return { type: 'mcp', code: raw.trim() }
    }

    // URL 直接入力の場合（後方互換）
    if (raw.startsWith('https://')) {
      return {
        type: 'mcp',
        serverUrl: raw.trim(),
        ttlMinutes: 30,
      }
    }

    return null
  }, [])

  /** ワーク接続を実行 */
  const connectToWork = useCallback(async (payload: MCPQRPayload) => {
    setIsConnecting(true)
    setError(null)

    try {
      const conn = await workService.connect({
        code: payload.code,
        serverUrl: payload.serverUrl,
        ttlMinutes: payload.ttlMinutes,
        metadata: payload.metadata,
      })

      // ストアにワーク接続を設定
      const store = useThemeStore.getState()
      store.setWorkConnection(conn)

      // テーマ一覧を再取得してから遷移
      const { themeService } = await import('@/services/themeService')
      const themes = await themeService.listThemes()
      store.setThemes(themes)

      // 作成されたトピックへ遷移
      onClose()
      navigate(`/themes/${conn.themeId}`)
    } catch (err) {
      console.error('[WorkConnect] 接続エラー:', err)
      setError(err instanceof Error ? err.message : '接続に失敗しました')
    } finally {
      setIsConnecting(false)
    }
  }, [navigate, onClose])

  /** QRコード検出時の処理 */
  const handleQRDetected = useCallback(async () => {
    if (!scanner.data) return

    const payload = parsePayload(scanner.data)
    if (!payload) {
      setError('無効なQRコードです')
      scanner.reset()
      return
    }

    await connectToWork(payload)
  }, [scanner, parsePayload, connectToWork])

  // QR検出時に自動接続
  if (scanner.status === 'found' && scanner.data && !isConnecting && !error) {
    handleQRDetected()
  }

  /** コード入力の変更ハンドラー（自動ハイフン挿入） */
  const handleCodeInputChange = useCallback((value: string) => {
    setError(null)
    // URL入力の場合はそのまま
    if (value.startsWith('https://') || value.startsWith('http')) {
      setCodeInput(value)
      return
    }
    // コード入力: 正規化（a-z以外除去 + 3文字ごとハイフン）
    setCodeInput(normalizeRegistryCode(value))
  }, [])

  /** コード入力タブからの接続 */
  const handleCodeSubmit = useCallback(async () => {
    const trimmed = codeInput.trim()
    const payload = parsePayload(trimmed)
    if (!payload) {
      if (trimmed && !trimmed.startsWith('https://')) {
        setError('無効なコードです。xxx-xxx-xxx 形式で入力してください。')
      } else {
        setError('無効なURLです。https:// で始まるURLを入力してください。')
      }
      return
    }
    await connectToWork(payload)
  }, [codeInput, parsePayload, connectToWork])

  /** タブ切り替え */
  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab)
    setError(null)
    if (tab === 'qr') {
      scanner.start()
    } else {
      scanner.stop()
    }
  }, [scanner])

  /** モーダルを閉じる */
  const handleClose = useCallback(() => {
    scanner.stop()
    setError(null)
    setCodeInput('')
    onClose()
  }, [scanner, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-testid="work-connect-modal">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">ワーク接続</h2>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
            data-testid="work-connect-close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* タブ */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => handleTabChange('code')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'code'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            コード入力
          </button>
          <button
            onClick={() => handleTabChange('qr')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'qr'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            QRコード
          </button>
        </div>

        {/* コンテンツ */}
        <div className="p-4">
          {activeTab === 'code' ? (
            <div className="space-y-3">
              <label className="block text-sm text-gray-700 dark:text-gray-300">
                ワークコード
              </label>
              <input
                type="text"
                value={codeInput}
                onChange={(e) => handleCodeInputChange(e.target.value)}
                placeholder="abc-def-ghi"
                className="w-full px-3 py-2.5 text-sm font-mono rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                data-testid="work-code-input"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <p className="text-xs text-gray-400 dark:text-gray-500">
                ワークコード（xxx-xxx-xxx）またはURLを入力
              </p>
              <button
                onClick={handleCodeSubmit}
                disabled={!codeInput.trim() || isConnecting}
                className="w-full py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                data-testid="work-connect-button"
              >
                {isConnecting ? '接続中...' : '接続'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* カメラビューファインダー */}
              <div className="relative aspect-square bg-black rounded-lg overflow-hidden">
                <video
                  ref={scanner.videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                {/* スキャン中のオーバーレイ */}
                {scanner.status === 'scanning' && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-48 h-48 border-2 border-white/50 rounded-lg" />
                  </div>
                )}
                {scanner.cameraStatus === 'starting' && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>
              <p className="text-xs text-center text-gray-500 dark:text-gray-400">
                QRコードをカメラに映してください
              </p>
            </div>
          )}

          {/* エラー表示 */}
          {error && (
            <div className="mt-3 p-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-sm text-red-600 dark:text-red-400" data-testid="work-connect-error">
              {error}
            </div>
          )}

          {/* 接続中のスピナー */}
          {isConnecting && (
            <div className="mt-3 flex items-center justify-center gap-2 text-sm text-gray-500">
              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              MCPサーバーに接続中...
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
