import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { useAuthStore } from '@/auth/authStore'
import { useAppStore } from '@/stores'
import { modelService } from '@/services/modelService'
import { skillClient } from '@/services/skillClient'
import { currentPlatform } from '@/platform'
import type { ServerModel } from '@/services/modelService'
import type { ModelReference, SkillConnection } from '@/types'
import { AVAILABLE_SKILLS } from '@/types'

type AibaTab = 'my' | 'skills' | 'shop' | 'studio'

/**
 * Ai-Ba（アイバ）フルページ画面
 *
 * タブ切替で「マイAi-Ba」「ショップ」「スタジオ」を表示。
 */
export function AibaScreen() {
  const [activeTab, setActiveTab] = useState<AibaTab>('my')

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* タブ */}
      <div className="flex bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0">
        {([
          { id: 'my' as const, label: 'マイAi-Ba', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
          { id: 'skills' as const, label: 'マイSkills', icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' },
          { id: 'shop' as const, label: 'ショップ', icon: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z' },
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
        {activeTab === 'my' && <MyAibaTab />}
        {activeTab === 'skills' && <SkillsTab />}
        {activeTab === 'shop' && <ShopTab />}
        {activeTab === 'studio' && <StudioTab />}
      </div>
    </div>
  )
}

/** マイAi-Ba タブ — キャラクター選択 */
function MyAibaTab() {
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

  if (authStatus !== 'authenticated') {
    return <p className="text-sm text-gray-500 dark:text-gray-400">ログインするとキャラクターを選択できます</p>
  }

  if (isLoading) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">読み込み中...</p>
  }

  if (serverModels.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">利用可能なキャラクターがありません</p>
  }

  return (
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
  )
}

/** マイSkills タブ — 外部サービス連携管理 */
function SkillsTab() {
  const [connections, setConnections] = useState<SkillConnection[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)

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
              className="flex items-center justify-between p-4 bg-white dark:bg-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-600"
              data-testid={`skill-row-${skill.id}`}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{skill.icon}</span>
                <div>
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
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
  )
}

/** ショップ タブ（プレースホルダー） */
function ShopTab() {
  return (
    <div>
      <div className="rounded-2xl bg-gradient-to-r from-purple-500 to-pink-500 p-5 md:p-7 text-white mb-6">
        <h3 className="text-lg font-bold">ショップ</h3>
        <p className="text-sm opacity-90 mt-1">新しいAi-Baキャラクターを見つけよう</p>
      </div>
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="text-5xl mb-4 opacity-30">&#128722;</div>
          <p className="text-gray-500 dark:text-gray-400 font-medium">Coming Soon</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">新しいキャラクターが近日登場予定です</p>
        </div>
      </div>
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
