import { useState, useEffect, useCallback, useRef } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router'
import { useAppStore } from './stores'
import { ChatUI, Live2DCanvas, Settings, ProfileModal, SkillsModal, ErrorNotification, ModelImporter, MotionPanel, OAuthCallback, GroupChatScreen, ThemeScreen, AppLayout, MemoScreen } from './components'
import type { Live2DCanvasHandle } from './components'
import type { UIConfig, UserProfile } from './types'
import { chatController } from './services/chatController'
import { syncService } from './services/syncService'
import { themeService } from './services/themeService'
import { greetingService } from './services/greetingService'
import { sentimentService } from './services/sentimentService'
import { useGeolocation } from './hooks/useGeolocation'
import { logPlatformInfo } from './platform'
import { getMemoryUsage } from './utils/performance'
import { AuthProvider, AuthModal, UserMenu, isAuthConfigured } from './auth'
import type { AuthView } from './auth'
import { useAuthStore } from './auth'
import { useThemeStore } from './stores/themeStore'
import { ttsService } from './services/ttsService'
import { AivisPoc, PollyPoc, SttPoc, GpsPoc, SentimentPoc, FaceTrackingPoc, PocIndex } from './poc'
import './App.css'

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const isPocPage = location.pathname.startsWith('/poc')

  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [isSkillsOpen, setIsSkillsOpen] = useState(false)
  const [isModelImporterOpen, setIsModelImporterOpen] = useState(false)
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)
  const [authModalInitialView, setAuthModalInitialView] = useState<AuthView>('login')
  const [isInitialized, setIsInitialized] = useState(false)
  const [greetingMessage, setGreetingMessage] = useState<string | null>(null)
  const greetingTriggeredRef = useRef(false)
  const prevSentimentRef = useRef<string>('neutral')
  const live2dRef = useRef<Live2DCanvasHandle>(null)

  // Auth store
  const authStatus = useAuthStore((s) => s.status)

  // 認証が必要かつ未認証かを判定
  const requiresAuth = isAuthConfigured() && authStatus !== 'authenticated'

  // Live2D を表示するルート: メイン会話 or テーマチャット（themeId あり）
  const showLive2D = !requiresAuth && !isPocPage && (
    location.pathname === '/' ||
    (location.pathname.startsWith('/themes/') && location.pathname !== '/themes')
  )

  // Zustand store
  const messages = useAppStore((state) => state.messages)
  const isLoading = useAppStore((state) => state.isLoading)
  const currentMotion = useAppStore((state) => state.currentMotion)
  const currentExpression = useAppStore((state) => state.currentExpression)
  const config = useAppStore((state) => state.config)
  const lastError = useAppStore((state) => state.lastError)
  const hasEarlierMessages = useAppStore((state) => state.hasEarlierMessages)
  const isLoadingEarlier = useAppStore((state) => state.isLoadingEarlier)
  const updateConfig = useAppStore((state) => state.updateConfig)
  const setError = useAppStore((state) => state.setError)
  const setCurrentExpression = useAppStore((state) => state.setCurrentExpression)
  const setCurrentMotion = useAppStore((state) => state.setCurrentMotion)
  const expressionVersion = useAppStore((state) => state.expressionVersion)

  // 位置情報フック
  const { location: geoLocation, loading: geoLoading, error: geoError, requestLocation, clearLocation } = useGeolocation()
  const setCurrentLocation = useAppStore((state) => state.setCurrentLocation)

  // Theme store
  const activeThemeId = useThemeStore((s) => s.activeThemeId)
  const themeThemes = useThemeStore((s) => s.themes)

  // 現在のセッション名を判定（設計書: ヘッダーにはセッション名のみ表示）
  const currentSessionName = location.pathname.startsWith('/themes') && activeThemeId
    ? themeThemes.find(t => t.themeId === activeThemeId)?.themeName ?? 'トピック'
    : location.pathname.startsWith('/themes')
      ? 'トピック'
      : location.pathname.startsWith('/groups')
        ? 'グループチャット'
        : 'AIチャット'

  // 初期化処理
  useEffect(() => {
    try {
      // プラットフォーム情報をログ出力（開発用）
      if (import.meta.env.DEV) {
        logPlatformInfo()
      }

      setIsInitialized(true)
    } catch (error) {
      console.error('初期化エラー:', error)
      setIsInitialized(true)
    }
  }, [])

  // 挨拶トリガー: メインAIチャット画面で1回だけ発火
  useEffect(() => {
    if (!isInitialized || requiresAuth || location.pathname !== '/' || greetingTriggeredRef.current) return
    greetingTriggeredRef.current = true

    if (greetingService.hasGreetedToday()) return

    const { lastActiveTimestamp } = useAppStore.getState()
    const greeting = greetingService.getGreeting(lastActiveTimestamp)

    // モーション・表情を再生
    setCurrentMotion(greeting.motion)
    const emotionMap: Record<string, string> = {
      neutral: 'exp_01', happy: 'exp_02', thinking: 'exp_03',
      surprised: 'exp_04', sad: 'exp_05', embarrassed: 'exp_06',
      troubled: 'exp_07', angry: 'exp_08',
    }
    setCurrentExpression(emotionMap[greeting.emotion] || 'exp_01')

    // TTS 発話（fire-and-forget）
    if (useAppStore.getState().config.ui.ttsEnabled) {
      ttsService.synthesizeAndPlay(greeting.message)
    }

    // 吹き出し表示 → 6秒後に消える
    setGreetingMessage(greeting.message)
    const timer = setTimeout(() => setGreetingMessage(null), 6000)

    greetingService.markGreeted()

    return () => clearTimeout(timer)
  }, [isInitialized, requiresAuth, location.pathname, setCurrentMotion, setCurrentExpression])

  // ページ非表示時に lastActiveTimestamp を更新
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        useAppStore.getState().updateLastActive()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

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

  // 入力テキスト感情分析ハンドラー（メインチャットのみ）
  const handleInputSentimentChange = useCallback((text: string) => {
    if (!config.ui.sentimentEnabled) return // 設定でOFFの場合はスキップ
    if (isLoading) return // LLM応答待ち中はスキップ（応答の emotion が優先）

    if (!text.trim()) {
      // テキストが空 → neutral に戻す
      if (prevSentimentRef.current !== 'neutral') {
        prevSentimentRef.current = 'neutral'
        setCurrentExpression('exp_01')
      }
      return
    }

    const result = sentimentService.analyzeSentiment(text)
    if (result.emotion !== prevSentimentRef.current) {
      prevSentimentRef.current = result.emotion
      setCurrentExpression(result.expression)
    }
  }, [config.ui.sentimentEnabled, isLoading, setCurrentExpression])

  // メッセージ送信ハンドラー
  const handleSendMessage = useCallback(async (text: string, imageBase64?: string) => {
    // 送信時に即座にキャラクターの表情を変える
    if (config.ui.sentimentEnabled) {
      const result = sentimentService.analyzeSentiment(text)
      prevSentimentRef.current = result.emotion
      setCurrentExpression(result.expression)
    }

    await chatController.sendMessage(text, imageBase64)
  }, [config.ui.sentimentEnabled, setCurrentExpression])

  // 過去メッセージ読み込みハンドラー
  const handleLoadEarlier = useCallback(async () => {
    const store = useAppStore.getState()
    const cursor = store.messagesCursor
    if (!cursor) return

    store.setLoadingEarlier(true)
    try {
      const result = await syncService.fetchEarlierMessages(cursor)
      store.prependMessages(result.messages)
      store.setMessagesCursor(result.nextCursor)
      store.setHasEarlierMessages(!!result.nextCursor)
    } catch (error) {
      console.error('[App] 過去メッセージ読み込みエラー:', error)
    } finally {
      store.setLoadingEarlier(false)
    }
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
    (newConfig: { ui?: Partial<UIConfig> }) => {
      const update: Partial<{ ui: UIConfig }> = {}
      if (newConfig.ui) {
        update.ui = { ...config.ui, ...newConfig.ui }
      }
      updateConfig(update)
    },
    [config, updateConfig]
  )

  // プロフィール保存ハンドラー
  const handleSaveProfile = useCallback(
    (profile: Partial<UserProfile>) => {
      updateConfig({ profile: { ...config.profile, ...profile } })
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

  // テーマ名リネームハンドラー
  const handleRenameTheme = useCallback(async (newName: string) => {
    if (!activeThemeId) return
    try {
      await themeService.renameTheme(activeThemeId, newName)
      const store = useThemeStore.getState()
      store.updateThemeName(activeThemeId, newName)
    } catch (error) {
      console.error('[App] テーマ名更新エラー:', error)
    }
  }, [activeThemeId])

  // テーマ提案から作成ハンドラー
  const handleCreateThemeFromSuggestion = useCallback(async (themeName: string) => {
    try {
      const result = await themeService.createTheme(themeName)
      const store = useThemeStore.getState()
      // テーマ一覧を更新
      const themes = await themeService.listThemes()
      store.setThemes(themes)
      // 作成したテーマに遷移
      navigate(`/themes/${result.themeId}`)
    } catch (error) {
      console.error('[App] テーマ作成エラー:', error)
    }
  }, [navigate])

  /** 認証モーダルを指定ビューで開く */
  const openAuthModal = useCallback((view: AuthView = 'login') => {
    setAuthModalInitialView(view)
    setIsAuthModalOpen(true)
  }, [])

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

  // 位置情報の取得/クリア（geolocationEnabled の切り替えに連動）
  useEffect(() => {
    console.log(`[App] geolocationEnabled changed: ${config.ui.geolocationEnabled}`)
    if (config.ui.geolocationEnabled) {
      requestLocation()
    } else {
      clearLocation()
      setCurrentLocation(null)
    }
  }, [config.ui.geolocationEnabled, requestLocation, clearLocation, setCurrentLocation])

  // 取得した位置情報を appStore に同期
  useEffect(() => {
    console.log(`[App] geoLocation changed:`, geoLocation)
    setCurrentLocation(geoLocation)
  }, [geoLocation, setCurrentLocation])

  // 位置情報エラーをログ出力
  useEffect(() => {
    if (geoError) {
      console.warn(`[App] 位置情報エラー: ${geoError}`)
    }
  }, [geoError])

  // 表情の変更を監視して再生（一定時間後に neutral に戻す）
  // expressionVersion を依存に含めることで、同じ表情名でも確実に再発火する
  useEffect(() => {
    if (currentExpression) {
      console.log(`[App] Playing expression: ${currentExpression} (v${expressionVersion})`)
      live2dRef.current?.playExpression(currentExpression)

      // neutral 以外の表情は5秒後に neutral に戻す
      if (currentExpression !== 'exp_01') {
        const timer = setTimeout(() => {
          live2dRef.current?.playExpression('exp_01')
          setCurrentExpression(null)
        }, 5000)

        return () => clearTimeout(timer)
      }
    }
  }, [currentExpression, expressionVersion, setCurrentExpression])

  // TTS 音声のリアルタイム音量を Live2D の口パラメータに反映（リップシンク）
  useEffect(() => {
    ttsService.setVolumeCallback((volume) => {
      live2dRef.current?.setMouthOpenness(volume)
    })
    return () => ttsService.setVolumeCallback(null)
  }, [])

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
      {requiresAuth ? (
        /* ウェルカム画面（AppLayout なし） */
        <div
          className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900"
          data-testid="welcome-screen"
        >
          <div className="text-center px-6 max-w-lg">
            <img
              src="/favicon.png"
              alt="App Logo"
              className="w-24 h-24 mx-auto mb-8 rounded-2xl shadow-lg"
            />
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-gray-100 mb-4">
              AIサポートアプリへ、ようこそ。
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mb-10 leading-relaxed">
              私たちは、あなたの思考と好みを深く理解するパートナーをアサインいたします。対話を重ねるごとに、AIはあなた固有の文脈を学び、代えがたい存在へと進化します。ぜひ、新しいデジタルライフの扉を叩いてみてください。
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => openAuthModal('login')}
                className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl shadow-md hover:shadow-lg transition-all"
                data-testid="welcome-login-button"
              >
                ログイン
              </button>
              <button
                onClick={() => openAuthModal('signup')}
                className="px-8 py-3 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 font-medium rounded-xl shadow-md hover:shadow-lg border border-gray-200 dark:border-gray-600 transition-all"
                data-testid="welcome-signup-button"
              >
                新規登録
              </button>
            </div>
          </div>
        </div>
      ) : (
        <AppLayout
          currentSessionName={currentSessionName}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onRenameSession={activeThemeId ? handleRenameTheme : undefined}
          headerRight={
            <>
              <UserMenu onOpenProfile={() => setIsProfileOpen(true)} onOpenSkills={() => setIsSkillsOpen(true)} />
              {config.ui.developerMode && (
                isPocPage ? (
                  <button
                    onClick={() => navigate('/')}
                    className="flex items-center gap-1 px-2 py-1 sm:px-3 sm:py-1.5 text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                    data-testid="back-button"
                  >
                    ← 戻る
                  </button>
                ) : (
                  <button
                    onClick={() => navigate('/poc')}
                    className="flex items-center gap-1 px-2 py-1 sm:px-3 sm:py-1.5 text-xs sm:text-sm font-medium text-orange-700 dark:text-orange-200 bg-orange-50 dark:bg-orange-900/50 border border-orange-300 dark:border-orange-700 rounded-lg hover:bg-orange-100 dark:hover:bg-orange-900 transition-colors"
                    data-testid="poc-button"
                  >
                    PoC
                  </button>
                )
              )}
              {config.ui.developerMode && (
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
              )}
            </>
          }
        >
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            {/* Live2Dキャラクター表示エリア — メイン会話 or テーマチャット時に表示 */}
            {showLive2D && (
              <div className="h-[25vh] md:h-auto md:w-1/3 md:min-w-[280px] md:max-w-[400px] bg-gradient-to-b from-blue-50 to-purple-50 dark:from-gray-800 dark:to-gray-900 border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-700 flex flex-col shrink-0 overflow-hidden">
                <div className="relative min-h-0 flex-1 overflow-hidden">
                  <Live2DCanvas
                    ref={live2dRef}
                    modelPath={config.model.currentModelId}
                    currentMotion={currentMotion}
                    onMotionComplete={handleMotionComplete}
                  />
                  {/* 挨拶吹き出し */}
                  {greetingMessage && location.pathname === '/' && (
                    <div
                      className="animate-greeting pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 max-w-[90%] px-4 py-2 bg-white/90 dark:bg-gray-800/90 rounded-xl shadow-lg text-sm text-gray-800 dark:text-gray-100 text-center"
                      data-testid="greeting-bubble"
                    >
                      {greetingMessage}
                    </div>
                  )}
                </div>
                <p className="text-center text-xs text-gray-500 dark:text-gray-400 py-1 shrink-0"
                   data-testid="character-nickname">
                  {config.profile.aiName || 'アリア'}
                </p>
                {/* モーションコントロールパネル（開発者モードのみ） */}
                {config.ui.developerMode && (
                  <div className="p-1 md:p-2 border-t border-gray-200 dark:border-gray-700 overflow-x-auto">
                    <MotionPanel
                      onPlayMotion={handlePlayMotion}
                      onPlayExpression={handlePlayExpression}
                    />
                  </div>
                )}
              </div>
            )}

            {/* ルーティング */}
            <div className="flex-1 flex flex-col min-h-0">
              <Routes>
                <Route path="/oauth/callback" element={<OAuthCallback />} />
                <Route path="/poc" element={<PocIndex />} />
                <Route path="/poc/aivis" element={<AivisPoc />} />
                <Route path="/poc/polly" element={<PollyPoc />} />
                <Route path="/poc/stt" element={<SttPoc />} />
                <Route path="/poc/gps" element={<GpsPoc />} />
                <Route path="/poc/sentiment" element={<SentimentPoc />} />
                <Route path="/poc/face-tracking" element={<FaceTrackingPoc />} />
                <Route path="/groups/:groupId" element={<GroupChatScreen />} />
                <Route path="/groups" element={<GroupChatScreen />} />
                <Route path="/themes/:themeId" element={<ThemeScreen />} />
                <Route path="/themes" element={<ThemeScreen />} />
                <Route path="/memos" element={<MemoScreen />} />
                <Route path="*" element={
                  <div className="flex-1 flex flex-col min-h-0" style={{ fontSize: `${config.ui.fontSize}px` }}>
                    <ChatUI
                      messages={messages}
                      isLoading={isLoading}
                      onSendMessage={handleSendMessage}
                      ttsEnabled={config.ui.ttsEnabled}
                      onToggleTts={(enabled) => updateConfig({ ui: { ...config.ui, ttsEnabled: enabled } })}
                      cameraEnabled={config.ui.cameraEnabled}
                      onToggleCamera={(enabled) => updateConfig({ ui: { ...config.ui, cameraEnabled: enabled } })}
                      developerMode={config.ui.developerMode}
                      hasEarlierMessages={hasEarlierMessages}
                      isLoadingEarlier={isLoadingEarlier}
                      onLoadEarlier={handleLoadEarlier}
                      onCreateTheme={handleCreateThemeFromSuggestion}
                      onInputSentimentChange={handleInputSentimentChange}
                    />
                  </div>
                } />
              </Routes>
            </div>
          </div>
        </AppLayout>
      )}

      {/* 設定モーダル */}
      <Settings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={{ ui: config.ui }}
        onSave={handleSaveSettings}
        geolocationStatus={{ location: geoLocation, loading: geoLoading, error: geoError }}
      />

      {/* スキル連携モーダル */}
      <SkillsModal
        isOpen={isSkillsOpen}
        onClose={() => setIsSkillsOpen(false)}
      />

      {/* プロフィールモーダル */}
      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        profile={config.profile}
        onSave={handleSaveProfile}
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
      <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} initialView={authModalInitialView} />

      {/* エラー通知 */}
      <ErrorNotification
        error={lastError}
        onDismiss={handleDismissError}
        autoDismissDelay={5000}
      />
    </AuthProvider>
  )
}

export default App
