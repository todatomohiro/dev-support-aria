import { useState, useEffect, useCallback } from 'react'
import { friendService } from '@/services/friendService'
import { useAppStore } from '@/stores/appStore'

interface UserCodeModalProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * ユーザーコードモーダル
 *
 * 自分のユーザーコードの共有と、相手のコードを入力してフレンドリンクする。
 */
export function UserCodeModal({ isOpen, onClose }: UserCodeModalProps) {
  const [myCode, setMyCode] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [otherCode, setOtherCode] = useState('')
  const [isLinking, setIsLinking] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const profile = useAppStore((s) => s.config.profile)

  /** ユーザーコードを取得または生成 */
  const loadOrGenerateCode = useCallback(async () => {
    setIsGenerating(true)
    try {
      // まず既存コードを取得
      const { code } = await friendService.getCode()
      if (code) {
        setMyCode(code)
      } else {
        // なければ生成
        const { code: newCode } = await friendService.generateCode()
        setMyCode(newCode)
      }
    } catch (err) {
      console.error('[UserCodeModal] コード取得エラー:', err)
      setError('コードの取得に失敗しました')
    } finally {
      setIsGenerating(false)
    }
  }, [])

  // モーダルが開かれた時にコードを取得
  useEffect(() => {
    if (isOpen) {
      loadOrGenerateCode()
      setOtherCode('')
      setError(null)
      setSuccessMessage(null)
      setCopied(false)
    }
  }, [isOpen, loadOrGenerateCode])

  /** コードをクリップボードにコピー */
  const handleCopy = useCallback(async () => {
    if (!myCode) return
    try {
      await navigator.clipboard.writeText(myCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      console.error('[UserCodeModal] コピーに失敗')
    }
  }, [myCode])

  /** ユーザーコードでリンク */
  const handleLink = useCallback(async () => {
    const code = otherCode.trim()
    if (!code) return

    setIsLinking(true)
    setError(null)

    try {
      const displayName = profile.nickname || 'ユーザー'
      await friendService.linkByCode(code, displayName)
      setSuccessMessage('フレンドを追加しました')
      setOtherCode('')
      // 少し待ってからモーダルを閉じる
      setTimeout(() => onClose(), 1500)
    } catch (err) {
      console.error('[UserCodeModal] リンクエラー:', err)
      setError('フレンドの追加に失敗しました。コードを確認してください。')
    } finally {
      setIsLinking(false)
    }
  }, [otherCode, profile.nickname, onClose])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      data-testid="user-code-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden"
        data-testid="user-code-panel"
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            フレンドを追加
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
            data-testid="user-code-close-button"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* コンテンツ */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[60vh]">
          {/* エラー表示 */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* 成功メッセージ */}
          {successMessage && (
            <div className="p-3 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg">
              <p className="text-sm text-green-600 dark:text-green-400">{successMessage}</p>
            </div>
          )}

          {/* 自分のコードを共有 */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              自分のユーザーコードを共有
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              このコードを相手に伝えてフレンドになりましょう
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1 px-3 py-2.5 bg-gray-100 dark:bg-gray-700 rounded-lg text-center">
                {isGenerating ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                    <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                    生成中...
                  </div>
                ) : (
                  <span
                    className="text-lg font-mono font-bold tracking-wider text-gray-900 dark:text-gray-100"
                    data-testid="my-user-code"
                  >
                    {myCode ?? '---'}
                  </span>
                )}
              </div>
              <button
                onClick={handleCopy}
                disabled={!myCode || isGenerating}
                className="shrink-0 px-3 py-2.5 text-sm font-medium text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-50 transition-colors"
                data-testid="copy-code-button"
              >
                {copied ? 'コピー済み' : 'コピー'}
              </button>
            </div>
          </div>

          {/* 区切り線 */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
            <span className="text-xs text-gray-400 dark:text-gray-500">または</span>
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
          </div>

          {/* 相手のコードを入力 */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              相手のユーザーコードを入力
            </h3>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={otherCode}
                onChange={(e) => setOtherCode(e.target.value)}
                placeholder="ユーザーコードを入力"
                className="flex-1 px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                data-testid="user-code-input"
              />
              <button
                onClick={handleLink}
                disabled={!otherCode.trim() || isLinking}
                className="shrink-0 px-4 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                data-testid="link-user-button"
              >
                {isLinking ? '追加中...' : '追加'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
