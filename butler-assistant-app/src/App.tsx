import { useState, useEffect, useCallback, useRef } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router'
import { useAppStore } from './stores'
import { ChatUI, Live2DCanvas, Settings, ProfileModal, ErrorNotification, MotionPanel, OAuthCallback, GroupChatScreen, ThemeScreen, AppLayout, MemoScreen, AibaScreen, StudioCamera, WeatherOverlay, SearchModal } from './components'
import type { Live2DCanvasHandle } from './components'
import type { UIConfig, UserProfile } from './types'
import { chatController } from './services/chatController'
import { syncService } from './services/syncService'
import { themeService } from './services/themeService'
import { greetingService } from './services/greetingService'
import { sentimentService } from './services/sentimentService'
import { useGeolocation } from './hooks/useGeolocation'
import { useBriefing } from './hooks/useBriefing'
import { useWeatherIcon } from './hooks/useWeatherIcon'
import { useWebSocket } from './hooks/useWebSocket'
import { useActivityLogger } from './hooks/useActivityLogger'
import { logPlatformInfo } from './platform'
import { getMemoryUsage } from './utils/performance'
import { AuthProvider, AuthModal, UserMenu, isAuthConfigured } from './auth'
import type { AuthView } from './auth'
import { useAuthStore } from './auth'
import { useThemeStore } from './stores/themeStore'
import { ttsService } from './services/ttsService'
import { AivisPoc, PollyPoc, SttPoc, GpsPoc, SentimentPoc, FaceTrackingPoc, TerminalPoc, PocIndex } from './poc'
import './App.css'

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const isPocPage = location.pathname.startsWith('/poc')

  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
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
  const showLive2DRoute = !requiresAuth && !isPocPage && (
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

  const characterVisible = config.ui.characterVisible ?? true
  const showLive2D = showLive2DRoute && characterVisible

  // 位置情報フック
  const { location: geoLocation, loading: geoLoading, error: geoError, requestLocation, clearLocation } = useGeolocation()

  // プロアクティブ・ブリーフィング（起動時・復帰時にAIから話しかける）
  useBriefing()

  // アクティビティログ（生活リズム学習、オプトイン時のみ有効）
  useActivityLogger()

  // 天気アイコン（位置情報ベース、LLM不使用）
  const weatherInfo = useWeatherIcon()
  const setCurrentLocation = useAppStore((state) => state.setCurrentLocation)
  const streamingText = useAppStore((state) => state.streamingText)

  // メインチャットでも WebSocket 接続を維持（ストリーミング用）
  useWebSocket(null)

  // Theme store
  const activeThemeId = useThemeStore((s) => s.activeThemeId)
  const themeThemes = useThemeStore((s) => s.themes)

  // 現在のセッション名を判定（設計書: ヘッダーにはセッション名のみ表示）
  const currentSessionName = location.pathname.startsWith('/aiba')
    ? 'Ai-Ba'
    : location.pathname.startsWith('/themes') && activeThemeId
      ? themeThemes.find(t => t.themeId === activeThemeId)?.themeName ?? 'トピック'
      : location.pathname.startsWith('/themes')
        ? 'トピック'
        : location.pathname.startsWith('/groups')
          ? 'グループチャット'
          : 'AIチャット'

  // Cmd+K で検索モーダルを開く
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsSearchOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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
      const update: Record<string, unknown> = {}
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

  // テーマ提案から作成ハンドラー（メイン会話の文脈を引き継ぐ）
  const handleCreateThemeFromSuggestion = useCallback(async (themeName: string) => {
    try {
      // メイン会話の直近メッセージからコンテキストを構築
      const appMessages = useAppStore.getState().messages
      const recentMessages = appMessages.slice(-6) // 直近3往復
      const contextLines = recentMessages
        .map((m) => `${m.role === 'user' ? 'ユーザー' : 'アシスタント'}: ${m.content.slice(0, 200)}`)
        .join('\n')

      // カテゴリ付きでテーマ作成（カテゴリ選択画面をスキップ）
      const result = await themeService.createTheme(themeName, 'free')
      const store = useThemeStore.getState()
      const themes = await themeService.listThemes()
      store.setThemes(themes)

      // 作成したテーマに遷移
      navigate(`/themes/${result.themeId}`)

      // コンテキスト付きで初期メッセージを自動送信（遷移後に非同期実行）
      setTimeout(async () => {
        const initialMessage = contextLines
          ? `メイン会話から「${themeName}」について続けたい。\n\n【これまでの会話の要約】\n${contextLines}`
          : `「${themeName}」について話したい`
        await chatController.sendThemeMessage(initialMessage, result.themeId)
      }, 300)
    } catch (error) {
      console.error('[App] テーマ作成エラー:', error)
    }
  }, [navigate])

  /** 認証モーダルを指定ビューで開く */
  const openAuthModal = useCallback((view: AuthView = 'login') => {
    setAuthModalInitialView(view)
    setIsAuthModalOpen(true)
  }, [])

  /** キャラクター表示/非表示トグル */
  const handleToggleCharacter = useCallback(() => {
    const next = !(config.ui.characterVisible ?? true)
    updateConfig({ ui: { ...config.ui, characterVisible: next } })
    if (next) {
      live2dRef.current?.startRendering()
    } else {
      live2dRef.current?.stopRendering()
    }
  }, [config.ui, updateConfig])

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

  // スタジオカメラは AppLayout 外の全画面表示（タブキャプチャ用）
  if (location.pathname === '/studio/camera') {
    return (
      <AuthProvider>
        <StudioCamera />
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
          onRenameSession={activeThemeId ? handleRenameTheme : undefined}
          headerRight={
            <>
              <button
                onClick={() => setIsSearchOpen(true)}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
                title="検索 (⌘K)"
                data-testid="search-button"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
              <UserMenu onOpenProfile={() => setIsProfileOpen(true)} onOpenSettings={() => setIsSettingsOpen(true)} />
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
            </>
          }
        >
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            {/* Live2Dキャラクター表示エリア — メイン会話 or テーマチャット時に表示 */}
            {showLive2D && (
              <div className="h-[25vh] md:h-auto md:w-1/3 md:min-w-[280px] md:max-w-[400px] bg-gradient-to-b from-blue-50 to-purple-50 dark:from-gray-800 dark:to-gray-900 border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-700 flex flex-col shrink-0 overflow-hidden">
                <div className="relative min-h-0 flex-1 overflow-hidden">
                  {/* 天気アイコン */}
                  {weatherInfo && <WeatherOverlay weather={weatherInfo} />}
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
                  {/* キャラクター非表示ボタン */}
                  <button
                    onClick={handleToggleCharacter}
                    className="absolute bottom-2 right-2 z-20 w-8 h-8 md:w-9 md:h-9 rounded-full bg-white/85 dark:bg-gray-700/85 border border-gray-300 dark:border-gray-600 shadow-sm flex items-center justify-center hover:bg-white dark:hover:bg-gray-600 hover:scale-105 transition-all"
                    title="キャラクターを非表示"
                    data-testid="character-hide-btn"
                  >
                    <svg className="w-4 h-4 md:w-[18px] md:h-[18px] text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M3 3l18 18" />
                    </svg>
                  </button>
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
            <div className="flex-1 flex flex-col min-h-0 relative">
              {/* キャラクター非表示時: 天気バッジ + 展開ボタン */}
              {showLive2DRoute && !characterVisible && (
                <div
                  className="absolute top-2 left-2 z-20 flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-black/5 dark:bg-white/10 backdrop-blur-sm"
                  data-testid="character-collapsed-bar"
                >
                  {weatherInfo && (
                    <div className="flex items-center gap-1 text-xs font-medium text-gray-600 dark:text-gray-300 pointer-events-none">
                      <svg className="w-4 h-4 md:w-[18px] md:h-[18px] text-amber-500" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <circle cx="16" cy="16" r="5" />
                        <line x1="16" y1="3" x2="16" y2="7" /><line x1="16" y1="25" x2="16" y2="29" />
                        <line x1="3" y1="16" x2="7" y2="16" /><line x1="25" y1="16" x2="29" y2="16" />
                      </svg>
                      <span>{weatherInfo.temperature}°C</span>
                    </div>
                  )}
                  <button
                    onClick={handleToggleCharacter}
                    className="w-7 h-7 rounded-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 shadow-sm flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-600 hover:scale-105 transition-all"
                    title="キャラクターを表示"
                    data-testid="character-show-btn"
                  >
                    <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </button>
                </div>
              )}
              <Routes>
                <Route path="/oauth/callback" element={<OAuthCallback />} />
                <Route path="/poc" element={<PocIndex />} />
                <Route path="/poc/aivis" element={<AivisPoc />} />
                <Route path="/poc/polly" element={<PollyPoc />} />
                <Route path="/poc/stt" element={<SttPoc />} />
                <Route path="/poc/gps" element={<GpsPoc />} />
                <Route path="/poc/sentiment" element={<SentimentPoc />} />
                <Route path="/poc/face-tracking" element={<FaceTrackingPoc />} />
                <Route path="/poc/terminal" element={<TerminalPoc />} />
                <Route path="/groups/:groupId" element={<GroupChatScreen />} />
                <Route path="/groups" element={<GroupChatScreen />} />
                <Route path="/themes/:themeId" element={<ThemeScreen />} />
                <Route path="/themes" element={<ThemeScreen />} />
                <Route path="/memos" element={<MemoScreen />} />
                <Route path="/aiba" element={<AibaScreen />} />
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
                      streamingText={streamingText}
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

      {/* 検索モーダル */}
      <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />

      {/* プロフィールモーダル */}
      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        profile={config.profile}
        onSave={handleSaveProfile}
      />

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
