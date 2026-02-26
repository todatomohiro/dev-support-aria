import { useEffect, useState, useCallback } from 'react'
import type { AppError } from '@/types'

interface ErrorNotificationProps {
  error: AppError | null
  onDismiss: () => void
  autoDismissDelay?: number
}

/**
 * エラーコードからエラータイプを取得
 */
function getErrorType(code: string): string {
  switch (code) {
    case 'NETWORK_ERROR':
      return 'network'
    case 'RATE_LIMIT_ERROR':
      return 'rateLimit'
    case 'API_ERROR':
      return 'api'
    case 'PARSE_ERROR':
      return 'parse'
    case 'VALIDATION_ERROR':
      return 'validation'
    case 'MODEL_LOAD_ERROR':
      return 'modelLoad'
    default:
      return 'unknown'
  }
}

/**
 * エラータイプに応じたアイコンとスタイルを取得
 */
function getErrorStyles(type: string): {
  bgColor: string
  borderColor: string
  textColor: string
  icon: React.ReactNode
} {
  switch (type) {
    case 'network':
      return {
        bgColor: 'bg-orange-50 dark:bg-orange-900/20',
        borderColor: 'border-orange-200 dark:border-orange-800',
        textColor: 'text-orange-800 dark:text-orange-200',
        icon: (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3"
            />
          </svg>
        ),
      }
    case 'rateLimit':
      return {
        bgColor: 'bg-yellow-50 dark:bg-yellow-900/20',
        borderColor: 'border-yellow-200 dark:border-yellow-800',
        textColor: 'text-yellow-800 dark:text-yellow-200',
        icon: (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        ),
      }
    case 'api':
      return {
        bgColor: 'bg-red-50 dark:bg-red-900/20',
        borderColor: 'border-red-200 dark:border-red-800',
        textColor: 'text-red-800 dark:text-red-200',
        icon: (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        ),
      }
    case 'parse':
      return {
        bgColor: 'bg-purple-50 dark:bg-purple-900/20',
        borderColor: 'border-purple-200 dark:border-purple-800',
        textColor: 'text-purple-800 dark:text-purple-200',
        icon: (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
            />
          </svg>
        ),
      }
    case 'validation':
      return {
        bgColor: 'bg-blue-50 dark:bg-blue-900/20',
        borderColor: 'border-blue-200 dark:border-blue-800',
        textColor: 'text-blue-800 dark:text-blue-200',
        icon: (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        ),
      }
    case 'modelLoad':
      return {
        bgColor: 'bg-gray-50 dark:bg-gray-700/50',
        borderColor: 'border-gray-200 dark:border-gray-600',
        textColor: 'text-gray-800 dark:text-gray-200',
        icon: (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        ),
      }
    default:
      return {
        bgColor: 'bg-red-50 dark:bg-red-900/20',
        borderColor: 'border-red-200 dark:border-red-800',
        textColor: 'text-red-800 dark:text-red-200',
        icon: (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        ),
      }
  }
}

/**
 * エラータイプに応じたタイトルを取得
 */
function getErrorTitle(type: string): string {
  switch (type) {
    case 'network':
      return 'ネットワークエラー'
    case 'rateLimit':
      return 'レート制限'
    case 'api':
      return 'APIエラー'
    case 'parse':
      return 'パースエラー'
    case 'validation':
      return 'バリデーションエラー'
    case 'modelLoad':
      return 'モデル読み込みエラー'
    default:
      return 'エラー'
  }
}

/**
 * エラー通知 コンポーネント
 */
export function ErrorNotification({
  error,
  onDismiss,
  autoDismissDelay = 5000,
}: ErrorNotificationProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)

  const handleDismiss = useCallback(() => {
    setIsLeaving(true)
    setTimeout(() => {
      setIsVisible(false)
      setIsLeaving(false)
      onDismiss()
    }, 300)
  }, [onDismiss])

  // エラーが変わったときに表示
  useEffect(() => {
    if (error) {
      setIsVisible(true)
      setIsLeaving(false)
    }
  }, [error])

  // 自動消去
  useEffect(() => {
    if (error && autoDismissDelay > 0) {
      const timer = setTimeout(handleDismiss, autoDismissDelay)
      return () => clearTimeout(timer)
    }
  }, [error, autoDismissDelay, handleDismiss])

  if (!error || !isVisible) return null

  const errorType = getErrorType(error.code)
  const styles = getErrorStyles(errorType)
  const title = getErrorTitle(errorType)

  return (
    <div
      className={`fixed top-4 right-4 z-50 max-w-sm w-full transform transition-all duration-300 ease-in-out ${
        isLeaving ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'
      }`}
      data-testid="error-notification"
      data-error-type={errorType}
    >
      <div
        className={`${styles.bgColor} ${styles.borderColor} ${styles.textColor} border rounded-lg shadow-lg p-4`}
      >
        <div className="flex items-start">
          <div className="flex-shrink-0">{styles.icon}</div>
          <div className="ml-3 flex-1">
            <h3 className="text-sm font-medium" data-testid="error-title">
              {title}
            </h3>
            <p className="mt-1 text-sm opacity-90" data-testid="error-message">
              {error.message || '予期しないエラーが発生しました'}
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 ml-2 p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            data-testid="dismiss-button"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* プログレスバー */}
        {autoDismissDelay > 0 && (
          <div className="mt-3 h-1 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-current opacity-50 rounded-full"
              style={{
                animation: `shrink ${autoDismissDelay}ms linear forwards`,
              }}
              data-testid="progress-bar"
            />
          </div>
        )}
      </div>

      <style>{`
        @keyframes shrink {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  )
}

/**
 * エラー通知フック
 * Zustandストアと連携して使用
 */
export function useErrorNotification(
  error: AppError | null,
  clearError: () => void
): {
  notificationProps: ErrorNotificationProps
} {
  return {
    notificationProps: {
      error,
      onDismiss: clearError,
    },
  }
}
