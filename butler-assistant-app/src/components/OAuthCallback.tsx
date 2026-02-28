import { useEffect, useState } from 'react'
import { skillClient } from '@/services/skillClient'

/**
 * OAuth リダイレクト先コンポーネント
 *
 * 認可コードを受け取り、バックエンドでトークン交換後、親ウィンドウに成功を通知して閉じる。
 */
export function OAuthCallback() {
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    const handleCallback = async () => {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      const error = params.get('error')

      if (error) {
        setStatus('error')
        setErrorMessage(`認証がキャンセルされました: ${error}`)
        return
      }

      if (!code) {
        setStatus('error')
        setErrorMessage('認可コードが見つかりません')
        return
      }

      try {
        await skillClient.exchangeCode(code)
        setStatus('success')

        // 親ウィンドウに成功を通知
        if (window.opener) {
          window.opener.postMessage({ type: 'oauth-success', service: 'google' }, window.location.origin)
        }

        // 自動で閉じる
        setTimeout(() => window.close(), 1500)
      } catch (err) {
        setStatus('error')
        setErrorMessage(err instanceof Error ? err.message : '認証に失敗しました')
      }
    }

    handleCallback()
  }, [])

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 max-w-sm text-center">
        {status === 'processing' && (
          <>
            <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-600 dark:text-gray-400">認証処理中...</p>
          </>
        )}
        {status === 'success' && (
          <>
            <div className="w-10 h-10 mx-auto mb-4 flex items-center justify-center bg-green-100 dark:bg-green-900 rounded-full">
              <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-gray-700 dark:text-gray-300 font-medium">連携が完了しました</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">このウィンドウは自動的に閉じます</p>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="w-10 h-10 mx-auto mb-4 flex items-center justify-center bg-red-100 dark:bg-red-900 rounded-full">
              <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="text-gray-700 dark:text-gray-300 font-medium">認証に失敗しました</p>
            <p className="text-sm text-red-500 dark:text-red-400 mt-1">{errorMessage}</p>
            <button
              onClick={() => window.close()}
              className="mt-4 px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              閉じる
            </button>
          </>
        )}
      </div>
    </div>
  )
}
