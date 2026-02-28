import { useState, useEffect, useCallback } from 'react'
import type { SkillConnection } from '@/types'
import { AVAILABLE_SKILLS } from '@/types'
import { skillClient } from '@/services/skillClient'

interface SkillsModalProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * スキル連携モーダル コンポーネント
 *
 * 外部サービス（Google カレンダー等）との連携を管理する。
 */
export function SkillsModal({ isOpen, onClose }: SkillsModalProps) {
  const [connections, setConnections] = useState<SkillConnection[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)

  /**
   * 接続済みサービスを取得
   */
  const loadConnections = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await skillClient.getConnections()
      setConnections(result)
    } catch (error) {
      console.error('[SkillsModal] 接続情報の取得に失敗:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // モーダルが開かれた時に接続状態を取得
  useEffect(() => {
    if (isOpen) {
      loadConnections()
    }
  }, [isOpen, loadConnections])

  // OAuth 成功の postMessage を受信
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type === 'oauth-success') {
        setIsConnecting(false)
        loadConnections()
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [loadConnections])

  /**
   * Google 連携を開始
   */
  const handleConnectGoogle = () => {
    setIsConnecting(true)
    try {
      skillClient.startGoogleOAuth()
    } catch (error) {
      console.error('[SkillsModal] OAuth 開始エラー:', error)
      setIsConnecting(false)
    }
  }

  /**
   * Google 連携を解除
   */
  const handleDisconnectGoogle = async () => {
    try {
      await skillClient.disconnectGoogle()
      setConnections((prev) => prev.filter((c) => c.service !== 'google'))
    } catch (error) {
      console.error('[SkillsModal] 連携解除エラー:', error)
    }
  }

  /**
   * サービスが接続済みかどうか
   */
  const isConnected = (serviceId: string) =>
    connections.some((c) => c.service === serviceId)

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      data-testid="skills-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden"
        data-testid="skills-panel"
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            スキル
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
            data-testid="skills-close-button"
          >
            <svg
              className="w-5 h-5 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* コンテンツ */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            外部サービスを連携すると、チャットからサービスを操作できます。
          </p>

          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-4">
              <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              読み込み中...
            </div>
          ) : (
            <div className="space-y-3">
              {AVAILABLE_SKILLS.map((skill) => (
                <div
                  key={skill.id}
                  className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
                  data-testid={`skill-row-${skill.id}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{skill.icon}</span>
                    <div>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {skill.name}
                      </span>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {skill.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isConnected(skill.id) ? (
                      <>
                        <span
                          className="px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/50 rounded"
                          data-testid={`skill-connected-${skill.id}`}
                        >
                          接続済み
                        </span>
                        <button
                          onClick={handleDisconnectGoogle}
                          className="px-3 py-1 text-xs text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 rounded hover:bg-red-50 dark:hover:bg-red-900/30"
                          data-testid={`skill-disconnect-${skill.id}`}
                        >
                          解除
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={handleConnectGoogle}
                        disabled={isConnecting}
                        className="px-3 py-1 text-xs text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-700 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-50"
                        data-testid={`skill-connect-${skill.id}`}
                      >
                        {isConnecting ? '接続中...' : '接続する'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
