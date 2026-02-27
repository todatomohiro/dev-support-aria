import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppStore } from './stores'
import { ChatUI, Live2DCanvas, Settings, ErrorNotification, ModelImporter, MotionPanel } from './components'
import type { Live2DCanvasHandle } from './components'
import { chatController } from './services/chatController'
import { llmClient } from './services/llmClient'
import { currentPlatform, logPlatformInfo } from './platform'
import { getMemoryUsage } from './utils/performance'
import { AuthProvider, AuthModal, UserMenu, isAuthConfigured } from './auth'
import { useAuthStore } from './auth'
import './App.css'

function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isModelImporterOpen, setIsModelImporterOpen] = useState(false)
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const live2dRef = useRef<Live2DCanvasHandle>(null)

  // Auth store
  const authStatus = useAuthStore((s) => s.status)

  // Zustand store
  const messages = useAppStore((state) => state.messages)
  const isLoading = useAppStore((state) => state.isLoading)
  const currentMotion = useAppStore((state) => state.currentMotion)
  const currentExpression = useAppStore((state) => state.currentExpression)
  const config = useAppStore((state) => state.config)
  const lastError = useAppStore((state) => state.lastError)
  const updateConfig = useAppStore((state) => state.updateConfig)
  const setError = useAppStore((state) => state.setError)
  const setCurrentExpression = useAppStore((state) => state.setCurrentExpression)

  // 初期化処理
  useEffect(() => {
    const initialize = async () => {
      try {
        // プラットフォーム情報をログ出力（開発用）
        if (import.meta.env.DEV) {
          logPlatformInfo()
        }

        // APIキーが未設定の場合は設定画面を開く
        if (!config.llm.apiKey) {
          setIsSettingsOpen(true)
        }

        setIsInitialized(true)
      } catch (error) {
        console.error('初期化エラー:', error)
        setIsInitialized(true)
      }
    }

    initialize()
  }, [config.llm.apiKey])

  // DEV モード: メモリ使用量を定期的にログ出力
  useEffect(() => {
    if (!import.meta.env.DEV) return

    const MEMORY_CHECK_INTERVAL = 30000 // 30秒
    const MEMORY_WARNING_THRESHOLD = 400 * 1024 * 1024 // 400MB

    const intervalId = setInterval(() => {
      const memory = getMemoryUsage()
      if (memory) {
        const usedMB = ((memory.usedJSHeapSize ?? 0) / (1024 * 1024)).toFixed(1)
        const totalMB = ((memory.totalJSHeapSize ?? 0) / (1024 * 1024)).toFixed(1)
        console.log(`[Memory] Used: ${usedMB}MB / Total: ${totalMB}MB`)

        if (memory.usedJSHeapSize && memory.usedJSHeapSize > MEMORY_WARNING_THRESHOLD) {
          console.warn(`[Memory] メモリ使用量が400MBを超過しています: ${usedMB}MB`)
        }
      }
    }, MEMORY_CHECK_INTERVAL)

    return () => clearInterval(intervalId)
  }, [])

  // メッセージ送信ハンドラー
  const handleSendMessage = useCallback(async (text: string) => {
    await chatController.sendMessage(text)
  }, [])

  // モーション完了ハンドラー
  const handleMotionComplete = useCallback(() => {
    chatController.returnToIdle()
  }, [])

  // モーション再生ハンドラー
  const handlePlayMotion = useCallback((group: string, index: number) => {
    live2dRef.current?.playMotion(group, index)
  }, [])

  // 表情再生ハンドラー（ストア経由で自動的に neutral に戻る）
  const handlePlayExpression = useCallback((name: string) => {
    setCurrentExpression(name)
  }, [setCurrentExpression])

  // 設定保存ハンドラー
  const handleSaveSettings = useCallback(
    (newConfig: { llm: Partial<typeof config.llm>; ui: Partial<typeof config.ui> }) => {
      updateConfig({
        llm: { ...config.llm, ...newConfig.llm },
        ui: { ...config.ui, ...newConfig.ui },
      })
    },
    [config, updateConfig]
  )

  // モデルインポート完了ハンドラー
  const handleModelImportComplete = useCallback((modelConfig: { id: string; name: string; modelPath: string }) => {
    setIsModelImporterOpen(false)
    // モデル切り替え
    updateConfig({
      model: { currentModelId: modelConfig.modelPath },
    })
  }, [updateConfig])

  // エラークリアハンドラー
  const handleDismissError = useCallback(() => {
    setError(null)
  }, [setError])

  // テーマの適用
  useEffect(() => {
    if (config.ui.theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [config.ui.theme])

  // LLM設定の適用
  useEffect(() => {
    llmClient.setProvider(config.llm.provider)
    if (config.llm.apiKey) {
      llmClient.setApiKey(config.llm.apiKey)
    }
  }, [config.llm.provider, config.llm.apiKey])

  // 表情の変更を監視して再生（一定時間後に neutral に戻す）
  useEffect(() => {
    if (currentExpression) {
      live2dRef.current?.playExpression(currentExpression)

      // neutral 以外の表情は3秒後に neutral に戻す
      if (currentExpression !== 'exp_01') {
        const timer = setTimeout(() => {
          live2dRef.current?.playExpression('exp_01')
        }, 3000)

        return () => clearTimeout(timer)
      }
    }
  }, [currentExpression])

  // ローディング画面
  if (!isInitialized) {
    return (
      <AuthProvider>
        <div className="flex items-center justify-center h-screen bg-gray-100 dark:bg-gray-900">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-600 dark:text-gray-400">初期化中...</p>
          </div>
        </div>
      </AuthProvider>
    )
  }

  return (
    <AuthProvider>
    <div className="h-screen flex flex-col bg-gray-100 dark:bg-gray-900 pb-[env(safe-area-inset-bottom)]">
      {/* ヘッダー */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 shrink-0 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between px-2 sm:px-4 py-2 sm:py-3 pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]">
          <div className="flex items-center gap-1 sm:gap-2">
            <h1 className="text-base sm:text-xl font-semibold text-gray-900 dark:text-gray-100">
              Butler Assistant
            </h1>
            <span className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 sm:py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded hidden sm:inline">
              {currentPlatform}
            </span>
          </div>

          <nav className="flex items-center gap-1 sm:gap-2">
            {isAuthConfigured() && authStatus !== 'authenticated' && authStatus !== 'loading' && (
              <button
                onClick={() => setIsAuthModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                data-testid="login-button"
              >
                ログイン
              </button>
            )}
            <UserMenu />
            <button
              onClick={() => setIsModelImporterOpen(true)}
              className="p-1.5 sm:p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
              title="モデルをインポート"
              data-testid="model-import-button"
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </button>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-1.5 sm:p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
              title="設定"
              data-testid="settings-button"
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </button>
          </nav>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Live2Dキャラクター表示エリア */}
        <div className="h-[40vh] md:h-auto md:w-1/3 md:min-w-[280px] md:max-w-[400px] bg-gradient-to-b from-blue-50 to-purple-50 dark:from-gray-800 dark:to-gray-900 border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-700 flex flex-col shrink-0">
          <div className="flex-1 flex items-center justify-center min-h-0">
            <Live2DCanvas
              ref={live2dRef}
              modelPath={config.model.currentModelId}
              currentMotion={currentMotion}
              onMotionComplete={handleMotionComplete}
            />
          </div>
          {/* モーションコントロールパネル */}
          <div className="p-1 md:p-2 border-t border-gray-200 dark:border-gray-700 overflow-x-auto">
            <MotionPanel
              onPlayMotion={handlePlayMotion}
              onPlayExpression={handlePlayExpression}
            />
          </div>
        </div>

        {/* チャットエリア */}
        <div className="flex-1 flex flex-col min-h-0" style={{ fontSize: `${config.ui.fontSize}px` }}>
          <ChatUI
            messages={messages}
            isLoading={isLoading}
            onSendMessage={handleSendMessage}
          />
        </div>
      </main>

      {/* 設定モーダル */}
      <Settings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={config}
        onSave={handleSaveSettings}
      />

      {/* モデルインポートモーダル */}
      {isModelImporterOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsModelImporterOpen(false)
          }}
        >
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                Live2Dモデルをインポート
              </h2>
              <button
                onClick={() => setIsModelImporterOpen(false)}
                className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4">
              <ModelImporter onImportComplete={handleModelImportComplete} />
            </div>
          </div>
        </div>
      )}

      {/* 認証モーダル */}
      <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />

      {/* エラー通知 */}
      <ErrorNotification
        error={lastError}
        onDismiss={handleDismissError}
        autoDismissDelay={5000}
      />
    </div>
    </AuthProvider>
  )
}

export default App
