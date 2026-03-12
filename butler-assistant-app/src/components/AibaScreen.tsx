import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router'
import { useAuthStore } from '@/auth/authStore'
import { useAppStore } from '@/stores'
import { modelService } from '@/services/modelService'
import { skillClient } from '@/services/skillClient'
import { usageService } from '@/services/usageService'
import { aivisTtsService } from '@/services/aivisTtsService'
import { webSpeechTtsService } from '@/services/webSpeechTtsService'
import { Live2DCanvas } from '@/components/Live2DCanvas'
import { ParticleBackground } from '@/components/ParticleBackground'
import { currentPlatform } from '@/platform'
import type { ServerModel } from '@/services/modelService'
import type { ModelReference, SkillConnection, UIConfig, UserPlan } from '@/types'
import { AVAILABLE_SKILLS } from '@/types'

type AibaTab = 'my' | 'skills' | 'shop' | 'studio'

/**
 * Ai-Ba（アイバ）フルページ画面
 *
 * タブ切替で「マイAi-Ba」「ショップ」「スタジオ」を表示。
 */
export function AibaScreen() {
  const location = useLocation()
  const initialTab = (location.state as { tab?: AibaTab } | null)?.tab ?? 'my'
  const [activeTab, setActiveTab] = useState<AibaTab>(initialTab)

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* タブ */}
      <div className="flex justify-center bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0">
        {([
          { id: 'my' as const, label: 'マイAi-Ba', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
          { id: 'skills' as const, label: 'マイSkills', icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' },
          { id: 'shop' as const, label: 'ｼｮｯﾌﾟ･ﾌﾟﾗﾝ', icon: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z' },
          { id: 'studio' as const, label: 'スタジオ', icon: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z' },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 md:flex-none md:px-6 flex items-center justify-center gap-1.5 py-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400'
                : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300'
            }`}
            data-testid={`aiba-tab-${tab.id}`}
          >
            <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
            </svg>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* タブコンテンツ */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-[760px] mx-auto w-full">
          {activeTab === 'my' && <MyAibaTab />}
          {activeTab === 'skills' && <SkillsTab />}
          {activeTab === 'shop' && <ShopTab />}
          {activeTab === 'studio' && <StudioTab />}
        </div>
      </div>
    </div>
  )
}

/** マイAi-Ba タブ — 話しかけるボタン + キャラクター選択 */
function MyAibaTab() {
  const navigate = useNavigate()
  const authStatus = useAuthStore((s) => s.status)
  const config = useAppStore((s) => s.config)
  const updateConfig = useAppStore((s) => s.updateConfig)
  const setActiveModelMeta = useAppStore((s) => s.setActiveModelMeta)

  const [serverModels, setServerModels] = useState<ServerModel[]>([])
  const [selectedModelId, setSelectedModelId] = useState<string>(config.model.selectedModelId ?? '')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const isDirty = selectedModelId !== (config.model.selectedModelId ?? '')

  const loadModels = useCallback(async () => {
    if (authStatus !== 'authenticated') return
    setIsLoading(true)
    try {
      const models = await modelService.listModels()
      setServerModels(models)
    } catch (error) {
      console.error('[AibaScreen] モデル一覧取得エラー:', error)
    } finally {
      setIsLoading(false)
    }
  }, [authStatus])

  useEffect(() => {
    loadModels()
  }, [loadModels])

  // config変更時にローカル状態を同期
  useEffect(() => {
    setSelectedModelId(config.model.selectedModelId ?? '')
  }, [config.model.selectedModelId])

  const handleSave = () => {
    setIsSaving(true)
    try {
      const selected = serverModels.find((m) => m.modelId === selectedModelId)
      const modelUpdate: Partial<ModelReference> = {
        selectedModelId: selectedModelId || undefined,
      }
      if (selected?.modelUrl) {
        modelUpdate.currentModelId = selected.modelUrl
      }
      updateConfig({ model: { ...config.model, ...modelUpdate } })

      if (selected) {
        setActiveModelMeta({
          modelId: selected.modelId,
          emotionMapping: selected.emotionMapping,
          motionMapping: selected.motionMapping,
        })
      }
    } finally {
      setIsSaving(false)
    }
  }

  /** 音声会話開始（ユーザージェスチャー内で AudioContext をアンロック） */
  const handleStartVoiceChat = async () => {
    await Promise.all([
      aivisTtsService.unlockAudio(),
      webSpeechTtsService.unlockAudio(),
    ])
    navigate('/aiba-alpha/voice')
  }

  if (authStatus !== 'authenticated') {
    return <p className="text-sm text-gray-500 dark:text-gray-400">ログインするとキャラクターを選択できます</p>
  }

  const currentModelName = serverModels.find((m) => m.modelId === config.model.selectedModelId)?.name

  return (
    <>
      {/* キャラクター表示エリア */}
      <div className="relative rounded-2xl overflow-hidden bg-gradient-to-b from-slate-900 to-slate-800 mb-5" style={{ height: 280 }}>
        <ParticleBackground count={12} />
        <Live2DCanvas
          modelPath={config.model.currentModelId}
          currentMotion={null}
          className="absolute inset-0"
          interactive={false}
        />
        {currentModelName && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-white/80 dark:bg-gray-700/80 backdrop-blur-sm rounded-full px-4 py-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
            {currentModelName}
          </div>
        )}
      </div>

      {/* 話しかけるボタン */}
      <div className="mb-6">
        <button
          onClick={handleStartVoiceChat}
          className="w-full py-4 rounded-2xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-bold text-base flex items-center justify-center gap-2.5 shadow-lg shadow-blue-500/30 hover:shadow-blue-500/40 hover:-translate-y-0.5 active:translate-y-0 transition-all"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-14 0m14 0a7 7 0 00-14 0m14 0v1a7 7 0 01-14 0v-1m7 8v4m-4 0h8" />
          </svg>
          話しかける
        </button>
        <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-2">
          タップして音声で会話を始めます
        </p>
      </div>

      {/* キャラクター選択 */}
      <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 mb-3">キャラクター選択</h3>
      {isLoading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">読み込み中...</p>
      ) : serverModels.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">利用可能なキャラクターがありません</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
            {serverModels.map((model) => {
              const isSelected = selectedModelId === model.modelId
              const isInUse = config.model.selectedModelId === model.modelId
              return (
                <button
                  key={model.modelId}
                  onClick={() => setSelectedModelId(model.modelId)}
                  className={`text-left rounded-2xl border-2 overflow-hidden transition-all ${
                    isSelected
                      ? 'border-blue-500 shadow-md ring-2 ring-blue-500/20'
                      : 'border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-700'
                  }`}
                  data-testid={`aiba-model-${model.modelId}`}
                >
                  <div className="relative h-32 md:h-40 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-gray-700 dark:to-gray-800 flex items-center justify-center">
                    <div className="w-16 h-20 md:w-20 md:h-24 bg-black/5 dark:bg-white/5 rounded-[40px_40px_20px_20px]" />
                    {isInUse && (
                      <span className="absolute top-2 right-2 bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                        使用中
                      </span>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{model.name}</div>
                    {model.description && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{model.description}</p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {/* 保存ボタン（変更がある場合のみ表示） */}
          {isDirty && (
            <div className="sticky bottom-0 mt-4 pb-2">
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="w-full md:w-auto md:min-w-[200px] mx-auto block px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold rounded-xl shadow-lg transition-colors"
                data-testid="aiba-save-button"
              >
                {isSaving ? '変更中...' : 'このキャラクターに変更'}
              </button>
            </div>
          )}
        </>
      )}
    </>
  )
}

/** 機能トグル定義 */
interface FeatureToggle {
  id: keyof Pick<UIConfig, 'geolocationEnabled' | 'sentimentEnabled' | 'activityLoggingEnabled'>
  name: string
  description: string
  icon: string
}

const FEATURE_TOGGLES: FeatureToggle[] = [
  {
    id: 'geolocationEnabled',
    name: '位置情報',
    description: '現在地を共有して近くの場所を検索できます',
    icon: '📍',
  },
  {
    id: 'sentimentEnabled',
    name: '入力中の表情変化',
    description: 'テキスト入力中にキャラクターの表情がリアルタイムで変化します',
    icon: '😊',
  },
  {
    id: 'activityLoggingEnabled',
    name: '生活リズム学習',
    description: '生活リズムを学習して最適なタイミングで話しかける準備を行います',
    icon: '🕐',
  },
]

/** マイSkills タブ — サービス連携 + 機能管理 */
function SkillsTab() {
  const config = useAppStore((s) => s.config)
  const updateConfig = useAppStore((s) => s.updateConfig)
  const [connections, setConnections] = useState<SkillConnection[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)

  /** 機能トグルの変更（即時反映） */
  const handleFeatureToggle = (featureId: FeatureToggle['id'], enabled: boolean) => {
    updateConfig({ ui: { ...config.ui, [featureId]: enabled } })
  }

  const loadConnections = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await skillClient.getConnections()
      setConnections(result)
    } catch (error) {
      console.error('[AibaScreen/Skills] 接続情報の取得に失敗:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConnections()
  }, [loadConnections])

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

  // Capacitor: appUrlOpen イベントで OAuth コールバックを受信
  useEffect(() => {
    if (currentPlatform !== 'capacitor') return

    let removed = false
    let cleanupRef: { remove: () => void } | undefined

    import('@capacitor/app').then(({ App }) => {
      if (removed) return
      App.addListener('appUrlOpen', async ({ url }) => {
        if (!url.includes('oauth/callback')) return
        const success = await skillClient.handleOAuthRedirect(url)
        if (success) {
          setIsConnecting(false)
          loadConnections()
        } else {
          setIsConnecting(false)
        }
        import('@capacitor/browser').then(({ Browser }) => { Browser.close() })
      }).then((handle) => { cleanupRef = handle })
    })

    return () => {
      removed = true
      cleanupRef?.remove()
    }
  }, [loadConnections])

  /** Google 連携を開始 */
  const handleConnect = (serviceId: string) => {
    if (serviceId === 'google') {
      setIsConnecting(true)
      try {
        skillClient.startGoogleOAuth()
      } catch (error) {
        console.error('[AibaScreen/Skills] OAuth 開始エラー:', error)
        setIsConnecting(false)
      }
    }
  }

  /** 連携を解除 */
  const handleDisconnect = async (serviceId: string) => {
    if (serviceId === 'google') {
      try {
        await skillClient.disconnectGoogle()
        setConnections((prev) => prev.filter((c) => c.service !== 'google'))
      } catch (error) {
        console.error('[AibaScreen/Skills] 連携解除エラー:', error)
      }
    }
  }

  const isConnected = (serviceId: string) =>
    connections.some((c) => c.service === serviceId)

  return (
    <div>
      {/* サービス連携セクション */}
      <div className="mb-8">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">サービス連携</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          外部サービスを連携すると、チャットからサービスを操作できます。
        </p>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-4">
            <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            読み込み中...
          </div>
        ) : (
          <div className="space-y-2">
            {AVAILABLE_SKILLS.map((skill) => (
              <div
                key={skill.id}
                className="flex items-center justify-between p-4 bg-white dark:bg-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-600/50 hover:border-gray-300 dark:hover:border-gray-500/50 transition-colors"
                data-testid={`skill-row-${skill.id}`}
              >
                <div className="flex items-center gap-3 md:gap-4">
                  <span className="text-2xl">{skill.icon}</span>
                  <div>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {skill.name}
                    </span>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {skill.description}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 md:gap-3">
                  {isConnected(skill.id) ? (
                    <>
                      <span className="px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/50 rounded">
                        接続済み
                      </span>
                      <button
                        onClick={() => handleDisconnect(skill.id)}
                        className="px-3 py-1 text-xs text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 rounded hover:bg-red-50 dark:hover:bg-red-900/30"
                      >
                        解除
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleConnect(skill.id)}
                      disabled={isConnecting}
                      className="px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-50"
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

      {/* 機能セクション */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">機能</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          各機能のON/OFFを切り替えられます。変更は即時反映されます。
        </p>

        <div className="space-y-2">
          {FEATURE_TOGGLES.map((feature) => (
            <label
              key={feature.id}
              className="flex items-center justify-between p-4 bg-white dark:bg-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-600/50 hover:border-gray-300 dark:hover:border-gray-500/50 transition-colors cursor-pointer"
              data-testid={`feature-row-${feature.id}`}
            >
              <div className="flex items-center gap-3 md:gap-4">
                <span className="text-2xl">{feature.icon}</span>
                <div>
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {feature.name}
                  </span>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {feature.description}
                  </p>
                </div>
              </div>
              <div
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                  config.ui[feature.id] ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <div
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    config.ui[feature.id] ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
                <input
                  type="checkbox"
                  checked={config.ui[feature.id]}
                  onChange={(e) => handleFeatureToggle(feature.id, e.target.checked)}
                  className="sr-only"
                  data-testid={`feature-toggle-${feature.id}`}
                />
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}

/** プラン比較行 */
const PLAN_COMPARISON = [
  { feature: '月額料金', freeDetail: '無料', premiumDetail: '¥600', platinumDetail: '¥2,000' },
  { feature: 'Normal モード', free: true, premium: true, platinum: true },
  { feature: 'Premium モード', free: false, premium: true, platinum: true },
  { feature: '1日の相談回数', freeDetail: '15回', premiumDetail: '40回', platinumDetail: '無制限' },
  { feature: '月間利用回数', freeDetail: '300回', premiumDetail: '1,000回', platinumDetail: '無制限' },
  { feature: 'Premium モード月間', freeDetail: '—', premiumDetail: '60回', platinumDetail: '200回' },
  { feature: 'キャラクター', freeDetail: '2体+購入', premiumDetail: '標準全+購入', platinumDetail: '標準全+購入' },
  { feature: '音声品質', freeDetail: '電子', premiumDetail: '電子', platinumDetail: 'ナチュラル' },
] as const

/** プラン表示情報 */
const PLAN_DISPLAY: Record<UserPlan, { label: string; gradient: string; icon: string; description: string }> = {
  free: { label: 'Free プラン', gradient: 'bg-gradient-to-r from-indigo-500 to-purple-500', icon: '\u2606', description: '基本機能を無料でご利用いただけます' },
  paid: { label: 'Premium プラン', gradient: 'bg-gradient-to-r from-amber-500 to-red-500', icon: '\u2605', description: '月額 ¥600 で Normal + Premium モードをご利用いただけます' },
  platinum: { label: 'Platinum プラン', gradient: 'bg-gradient-to-r from-slate-600 to-slate-900', icon: '\uD83D\uDC8E', description: '月額 ¥2,000 で Normal + Premium モードを無制限でご利用いただけます' },
}

/** ショップ・プラン タブ */
function ShopTab() {
  const usageInfo = useAppStore((s) => s.usageInfo)
  const setUsageInfo = useAppStore((s) => s.setUsageInfo)
  const [isChanging, setIsChanging] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState<UserPlan | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const plan = usageInfo?.plan ?? 'free'
  const isFree = plan === 'free'
  const isPaid = plan === 'paid'
  const isPlatinum = plan === 'platinum'
  const planInfo = PLAN_DISPLAY[plan]

  /** プラン変更を実行 */
  const handlePlanChange = async () => {
    if (!confirmTarget) return
    setIsChanging(true)
    setConfirmTarget(null)
    try {
      const success = await usageService.updatePlan(confirmTarget)
      if (success) {
        const updated = await usageService.fetchUsage()
        if (updated) setUsageInfo(updated)
        setSuccessMessage(`${PLAN_DISPLAY[confirmTarget].label}に切り替えました${confirmTarget !== 'free' ? '！' : ''}`)
        setTimeout(() => setSuccessMessage(null), 5000)
      }
    } catch {
      // エラーは usageService 内でログ済み
    } finally {
      setIsChanging(false)
    }
  }

  /** 日次/月次の表示値 */
  const dailyLabel = isFree ? '15 回' : isPaid ? '40 回' : '無制限'
  const monthlyLabel = isFree ? '300 回' : isPaid ? '1,000 回' : '無制限'
  const premiumMonthlyLabel = isFree ? '—' : isPaid ? '60 回' : '200 回'

  return (
    <div>
      {/* 成功バナー */}
      {successMessage && (
        <div className="flex items-center gap-2.5 p-3.5 mb-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300 text-sm font-semibold">
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          {successMessage}
        </div>
      )}

      {/* プランバナー */}
      <div className={`rounded-2xl p-5 md:p-7 text-white mb-5 relative overflow-hidden ${planInfo.gradient}`}>
        <div className="absolute top-3 right-4 text-3xl md:text-4xl opacity-30">{planInfo.icon}</div>
        <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-white/20 mb-2.5">
          CURRENT PLAN
        </span>
        <h3 className="text-xl md:text-2xl font-extrabold">{planInfo.label}</h3>
        <p className="text-sm opacity-90 mt-1">{planInfo.description}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* 左カラム */}
        <div className="space-y-5">
          {/* 利用状況 */}
          {usageInfo && (
            <div className="bg-white dark:bg-gray-700/50 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-600/30">
              <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3.5">今日の利用状況</h4>
              {usageInfo.daily.limit > 0 && <UsageBar label="1日の相談回数" used={usageInfo.daily.used} limit={usageInfo.daily.limit} />}
              {usageInfo.daily.limit < 0 && (
                <div className="flex justify-between text-xs mb-3.5">
                  <span className="text-gray-500 dark:text-gray-400">1日の相談回数</span>
                  <span className="font-semibold text-green-500">無制限</span>
                </div>
              )}
              {usageInfo.monthly.limit > 0 && <UsageBar label="今月の利用回数" used={usageInfo.monthly.used} limit={usageInfo.monthly.limit} />}
              {usageInfo.monthly.limit < 0 && (
                <div className="flex justify-between text-xs mb-3.5">
                  <span className="text-gray-500 dark:text-gray-400">今月の利用回数</span>
                  <span className="font-semibold text-green-500">無制限</span>
                </div>
              )}
              {!isFree && usageInfo.premiumMonthly.limit > 0 && (
                <UsageBar label="Premium モード（月間）" used={usageInfo.premiumMonthly.used} limit={usageInfo.premiumMonthly.limit} />
              )}
            </div>
          )}

          {/* プラン内容 */}
          <div className="bg-white dark:bg-gray-700/50 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-600/30">
            <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3.5">プラン内容</h4>
            <PlanRow icon="&#9883;" iconBg="bg-purple-100 dark:bg-purple-900/30 text-purple-600" label="演算モード" value={isFree ? 'Normal のみ' : 'Normal + Premium'} unlimited={!isFree} />
            <PlanRow icon="&#128197;" iconBg="bg-amber-100 dark:bg-amber-900/30 text-amber-600" label="1日の上限" value={dailyLabel} limited={isFree} unlimited={isPlatinum} />
            <PlanRow icon="&#128200;" iconBg="bg-blue-100 dark:bg-blue-900/30 text-blue-600" label="月間上限" value={monthlyLabel} limited={isFree} unlimited={isPlatinum} />
            {!isFree && <PlanRow icon="&#11088;" iconBg="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600" label="Premium 月間" value={premiumMonthlyLabel} />}
            <PlanRow icon="&#128100;" iconBg="bg-pink-100 dark:bg-pink-900/30 text-pink-600" label="キャラクター" value={isFree ? '2体 + 購入キャラ' : '標準キャラ全て + 購入キャラ'} unlimited={!isFree} last />
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 ml-9">※購入キャラは別途ショップでの購入が必要です</p>
          </div>
        </div>

        {/* 右カラム */}
        <div className="space-y-5">
          {/* プラン比較 */}
          <div className="bg-white dark:bg-gray-700/50 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-600/30">
            <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3.5">プラン比較</h4>
            <div className="grid grid-cols-[1fr_55px_55px_55px] gap-x-1.5 pb-2.5 mb-1 border-b-2 border-gray-100 dark:border-gray-600/30">
              <span />
              <span className={`text-[11px] font-bold text-center ${isFree ? 'text-indigo-500' : 'text-gray-400'}`}>Free</span>
              <span className={`text-[11px] font-bold text-center ${isPaid ? 'text-amber-500' : 'text-gray-400'}`}>Premium</span>
              <span className={`text-[11px] font-bold text-center ${isPlatinum ? 'text-slate-700 dark:text-slate-300' : 'text-gray-400'}`}>Platinum</span>
            </div>
            {PLAN_COMPARISON.map((row) => (
              <div key={row.feature} className="grid grid-cols-[1fr_55px_55px_55px] gap-x-1.5 py-2.5 border-b border-gray-50 dark:border-gray-600/20 last:border-0 items-center">
                <span className="text-[12px] text-gray-800 dark:text-gray-200">{row.feature}</span>
                {'free' in row ? (
                  <>
                    <span className={`text-center text-sm ${row.free ? 'text-green-500' : 'text-gray-300 dark:text-gray-600'}`}>{row.free ? '\u2713' : '\u2715'}</span>
                    <span className={`text-center text-sm ${row.premium ? 'text-green-500' : 'text-gray-300 dark:text-gray-600'}`}>{row.premium ? '\u2713' : '\u2715'}</span>
                    <span className={`text-center text-sm ${row.platinum ? 'text-green-500' : 'text-gray-300 dark:text-gray-600'}`}>{row.platinum ? '\u2713' : '\u2715'}</span>
                  </>
                ) : (
                  <>
                    <span className="text-center text-[11px] text-gray-500 dark:text-gray-400">{row.freeDetail}</span>
                    <span className="text-center text-[11px] text-gray-500 dark:text-gray-400">{row.premiumDetail}</span>
                    <span className="text-center text-[11px] text-gray-500 dark:text-gray-400">{row.platinumDetail}</span>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* メンバーカード（有料プランのみ） */}
          {!isFree && (
            <div className="bg-white dark:bg-gray-700/50 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-600/30 text-center">
              <div className="text-5xl mb-3">{planInfo.icon}</div>
              <h4 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-2">{isPlatinum ? 'Platinum' : 'Premium'} メンバー</h4>
              <p className="text-[13px] text-gray-500 dark:text-gray-400 leading-relaxed mb-4">
                {isPlatinum ? 'すべての機能を最大限にお楽しみいただけます。' : 'Normal + Premium モードをお楽しみいただけます。'}<br />ご利用ありがとうございます。
              </p>
            </div>
          )}

          {/* プラン変更ボタン群 */}
          <div className="space-y-2">
            {/* アップグレードボタン */}
            {isFree && (
              <>
                <button
                  onClick={() => setConfirmTarget('paid')}
                  disabled={isChanging}
                  className="w-full py-3.5 rounded-xl text-[15px] font-bold text-white bg-gradient-to-r from-amber-500 to-red-500 shadow-md shadow-amber-500/30 hover:shadow-lg hover:shadow-amber-500/40 hover:-translate-y-0.5 transition-all disabled:opacity-60 cursor-pointer"
                >
                  {isChanging ? '切り替え中...' : '\u2728 Premium にアップグレード（¥600/月）'}
                </button>
                <button
                  onClick={() => setConfirmTarget('platinum')}
                  disabled={isChanging}
                  className="w-full py-3.5 rounded-xl text-[15px] font-bold text-white bg-gradient-to-r from-slate-600 to-slate-900 shadow-md shadow-slate-500/30 hover:shadow-lg hover:shadow-slate-500/40 hover:-translate-y-0.5 transition-all disabled:opacity-60 cursor-pointer"
                >
                  {isChanging ? '切り替え中...' : '\uD83D\uDC8E Platinum にアップグレード（¥2,000/月）'}
                </button>
              </>
            )}
            {isPaid && (
              <>
                <button
                  onClick={() => setConfirmTarget('platinum')}
                  disabled={isChanging}
                  className="w-full py-3.5 rounded-xl text-[15px] font-bold text-white bg-gradient-to-r from-slate-600 to-slate-900 shadow-md shadow-slate-500/30 hover:shadow-lg hover:shadow-slate-500/40 hover:-translate-y-0.5 transition-all disabled:opacity-60 cursor-pointer"
                >
                  {isChanging ? '切り替え中...' : '\uD83D\uDC8E Platinum にアップグレード（¥2,000/月）'}
                </button>
                <div className="text-center">
                  <button
                    onClick={() => setConfirmTarget('free')}
                    disabled={isChanging}
                    className="text-xs text-gray-400 dark:text-gray-500 underline cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50"
                  >
                    {isChanging ? '切り替え中...' : 'Free プランに戻す'}
                  </button>
                </div>
              </>
            )}
            {isPlatinum && (
              <div className="space-y-2">
                <button
                  disabled
                  className="w-full py-3.5 rounded-xl text-[15px] font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 cursor-default"
                >
                  {'\u2713'} 現在のプラン
                </button>
                <div className="text-center">
                  <button
                    onClick={() => setConfirmTarget('paid')}
                    disabled={isChanging}
                    className="text-xs text-gray-400 dark:text-gray-500 underline cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50"
                  >
                    Premium プランに変更
                  </button>
                  <span className="text-xs text-gray-300 dark:text-gray-600 mx-2">|</span>
                  <button
                    onClick={() => setConfirmTarget('free')}
                    disabled={isChanging}
                    className="text-xs text-gray-400 dark:text-gray-500 underline cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50"
                  >
                    Free プランに戻す
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* キャラクターショップ */}
      <div className="mt-6">
        <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3">キャラクターショップ</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { name: 'サクラ', emoji: '\uD83D\uDC83', bg: 'from-pink-100 to-pink-50 dark:from-pink-900/20 dark:to-pink-900/10' },
            { name: 'カイ', emoji: '\uD83E\uDD16', bg: 'from-blue-100 to-blue-50 dark:from-blue-900/20 dark:to-blue-900/10', locked: isFree },
            { name: 'ルナ', emoji: '\uD83D\uDC31', bg: 'from-green-100 to-green-50 dark:from-green-900/20 dark:to-green-900/10', locked: isFree },
            { name: 'レン', emoji: '\uD83D\uDE0E', bg: 'from-amber-100 to-amber-50 dark:from-amber-900/20 dark:to-amber-900/10', locked: isFree },
          ].map((item) => (
            <div key={item.name} className="bg-white dark:bg-gray-700/50 rounded-xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-600/30 hover:-translate-y-0.5 hover:shadow-md transition-all">
              <div className={`relative h-24 bg-gradient-to-br ${item.bg} flex items-center justify-center text-4xl`}>
                {item.emoji}
                {item.locked && (
                  <span className="absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-red-500 text-white">
                    Premium
                  </span>
                )}
              </div>
              <div className="p-2.5">
                <div className="text-[13px] font-bold text-gray-900 dark:text-gray-100">{item.name}</div>
                <div className="text-[11px] text-gray-400 dark:text-gray-500">Coming Soon</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 確認ダイアログ */}
      {confirmTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm text-center shadow-xl">
            <div className="text-4xl mb-3">{confirmTarget === 'platinum' ? '\uD83D\uDC8E' : confirmTarget === 'paid' ? '\u2728' : '\u2606'}</div>
            <h3 className="text-[17px] font-bold text-gray-900 dark:text-gray-100 mb-2">
              {confirmTarget === 'free' ? 'Free プランに戻す' : `${PLAN_DISPLAY[confirmTarget].label}に${plan === 'platinum' ? '変更' : 'アップグレード'}`}
            </h3>
            <p className="text-[13px] text-gray-500 dark:text-gray-400 leading-relaxed mb-4">
              {confirmTarget === 'platinum'
                ? 'Platinum プランに切り替えると、Normal モード無制限 + Premium モード 200回/月 が利用できるようになります。'
                : confirmTarget === 'paid'
                  ? 'Premium プランに切り替えると、Normal モード 40回/日 + Premium モード 60回/月 が利用できるようになります。'
                  : 'Free プランに戻すと、Normal モードのみ・15回/日 に戻ります。'}
            </p>

            {confirmTarget !== 'free' && (
              <div className={`rounded-xl p-3 mb-4 text-left ${confirmTarget === 'platinum' ? 'bg-slate-50 dark:bg-slate-900/20' : 'bg-amber-50 dark:bg-amber-900/20'}`}>
                <div className={`text-xs font-semibold mb-1.5 ${confirmTarget === 'platinum' ? 'text-slate-800 dark:text-slate-300' : 'text-amber-800 dark:text-amber-300'}`}>
                  {PLAN_DISPLAY[confirmTarget].label}の内容:
                </div>
                <div className={`text-xs leading-loose ${confirmTarget === 'platinum' ? 'text-slate-700 dark:text-slate-400' : 'text-amber-700 dark:text-amber-400'}`}>
                  {'\u2713'} Premium（詳細モード）が利用可能<br />
                  {confirmTarget === 'platinum' ? (
                    <>
                      {'\u2713'} Normal モード 無制限<br />
                      {'\u2713'} Premium モード 200回/月<br />
                    </>
                  ) : (
                    <>
                      {'\u2713'} Normal 40回/日・1,000回/月<br />
                      {'\u2713'} Premium モード 60回/月<br />
                    </>
                  )}
                  {'\u2713'} 全キャラクター利用可能
                </div>
              </div>
            )}

            <div className="flex gap-2.5">
              <button
                onClick={() => setConfirmTarget(null)}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 cursor-pointer"
              >
                キャンセル
              </button>
              <button
                onClick={handlePlanChange}
                className={`flex-1 py-3 rounded-xl text-sm font-semibold text-white cursor-pointer ${
                  confirmTarget === 'platinum'
                    ? 'bg-gradient-to-r from-slate-600 to-slate-900'
                    : confirmTarget === 'paid'
                      ? 'bg-gradient-to-r from-amber-500 to-red-500'
                      : 'bg-gray-500'
                }`}
              >
                切り替える
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 利用状況バー */
function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-green-500'
  return (
    <div className="mb-3.5 last:mb-0">
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-gray-500 dark:text-gray-400">{label}</span>
        <span className="font-semibold text-gray-800 dark:text-gray-200">{used} / {limit} 回</span>
      </div>
      <div className="h-2 bg-gray-100 dark:bg-gray-600 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/** プラン内容行 */
function PlanRow({ icon, iconBg, label, value, limited, unlimited, last }: {
  icon: string; iconBg: string; label: string; value: string; limited?: boolean; unlimited?: boolean; last?: boolean
}) {
  return (
    <div className={`flex items-center justify-between py-2.5 ${last ? '' : 'border-b border-gray-50 dark:border-gray-600/20'}`}>
      <div className="flex items-center gap-2 text-[13px] text-gray-500 dark:text-gray-400">
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm ${iconBg}`} dangerouslySetInnerHTML={{ __html: icon }} />
        {label}
      </div>
      <span className={`text-[13px] font-semibold ${limited ? 'text-red-500' : unlimited ? 'text-green-500' : 'text-gray-800 dark:text-gray-200'}`}>
        {value}
      </span>
    </div>
  )
}

/** スタジオ タブ */
function StudioTab() {
  const navigate = useNavigate()

  return (
    <div>
      <div className="rounded-2xl bg-gradient-to-r from-gray-700 to-gray-900 p-8 md:p-10 text-white text-center mb-6">
        <div className="text-5xl mb-3">&#127909;</div>
        <h3 className="text-lg font-bold">Ai-Ba スタジオ</h3>
        <p className="text-sm opacity-80 mt-2">カメラを使ってAi-Baと一緒に写真や動画を撮影しよう</p>
      </div>
      <div className="flex flex-col md:flex-row gap-3 md:gap-4">
        {([
          { id: 'virtual-camera', icon: '&#127909;', title: '仮想カメラ', desc: 'Meet / Zoom でキャラクターをカメラとして使用', color: 'bg-indigo-50 dark:bg-indigo-900/20', available: true },
          { id: 'face-tracking', icon: '&#128247;', title: 'フェイストラッキング', desc: 'カメラで表情をリアルタイム連動', color: 'bg-blue-50 dark:bg-blue-900/20', available: true },
          { id: 'ar', icon: '&#10024;', title: 'AR撮影', desc: '現実世界にAi-Baを召喚して撮影', color: 'bg-purple-50 dark:bg-purple-900/20', available: false },
          { id: 'snapshot', icon: '&#128248;', title: 'スナップ撮影', desc: 'ポーズを指定してスクリーンショット', color: 'bg-pink-50 dark:bg-pink-900/20', available: false },
        ]).map((item) => (
          <button
            key={item.id}
            onClick={() => {
              if (item.id === 'virtual-camera') navigate('/studio/camera')
              if (item.id === 'face-tracking') navigate('/poc/face-tracking')
            }}
            className={`flex md:flex-col items-center md:items-center gap-3 md:gap-0 md:text-center p-4 md:p-6 rounded-2xl border border-gray-200 dark:border-gray-600 transition-colors flex-1 ${
              item.available ? 'hover:border-blue-400 dark:hover:border-blue-600 cursor-pointer' : 'opacity-60 cursor-default'
            }`}
            disabled={!item.available}
          >
            <div className={`w-11 h-11 md:w-14 md:h-14 rounded-xl ${item.color} flex items-center justify-center text-2xl md:text-3xl shrink-0 md:mb-3`}
              dangerouslySetInnerHTML={{ __html: item.icon }}
            />
            <div className="text-left md:text-center">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {item.title}
                {!item.available && (
                  <span className="ml-1.5 inline-block bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 text-[10px] font-semibold px-1.5 py-0.5 rounded">
                    Coming Soon
                  </span>
                )}
              </h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{item.desc}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Chrome 拡張の案内 */}
      <div className="mt-6 p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-200 dark:border-indigo-800">
        <h4 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200 mb-2">
          仮想カメラの使い方
        </h4>
        <ol className="text-xs text-indigo-700 dark:text-indigo-300 space-y-1 list-decimal list-inside">
          <li>Chrome 拡張「Ai-Ba Virtual Camera」をインストール</li>
          <li>上の「仮想カメラ」を開いてトラッキングを開始</li>
          <li>Meet / Zoom ページ右下の「Ai-Ba Camera」ボタンをクリック</li>
          <li>タブ選択画面で「Ai-Ba Studio Camera」タブを選択</li>
        </ol>
      </div>
    </div>
  )
}
