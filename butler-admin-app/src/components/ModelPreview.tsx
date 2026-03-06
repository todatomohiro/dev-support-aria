import { useState, useEffect, useRef, useCallback } from 'react'
import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import { adminApi } from '@/services/adminApi'
import { useAuthStore } from '@/auth/authStore'
import type { ModelMeta } from '@/types/admin'

// pixi-live2d-display が必要とする
if (typeof window !== 'undefined') {
  ;(window as any).PIXI = PIXI
}

const MODELS_CDN_BASE = import.meta.env.VITE_MODELS_CDN_BASE as string | undefined

/**
 * モデルプレビュー＆マッピングテストページ
 */
export function ModelPreview() {
  const token = useAuthStore((s) => s.idToken)
  const [models, setModels] = useState<ModelMeta[]>([])
  const [selectedModel, setSelectedModel] = useState<ModelMeta | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  // Live2D
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<PIXI.Application | null>(null)
  const modelRef = useRef<Live2DModel | null>(null)
  const [modelLoading, setModelLoading] = useState(false)
  const [modelError, setModelError] = useState('')

  // 現在の状態表示
  const [activeExpression, setActiveExpression] = useState('')
  const [activeMotion, setActiveMotion] = useState('')

  /** モデル一覧を読み込み */
  useEffect(() => {
    if (!token) return
    setIsLoading(true)
    adminApi.listModels(token)
      .then((result) => setModels(result.models))
      .catch((err) => setError(err instanceof Error ? err.message : '読み込みエラー'))
      .finally(() => setIsLoading(false))
  }, [token])

  /** Live2D モデルを読み込み */
  const loadModel = useCallback(async (model: ModelMeta) => {
    setSelectedModel(model)
    setModelLoading(true)
    setModelError('')
    setActiveExpression('')
    setActiveMotion('')

    // 既存モデルを破棄
    if (modelRef.current) {
      modelRef.current.destroy()
      modelRef.current = null
    }
    if (appRef.current) {
      appRef.current.destroy(true, { children: true, texture: true, baseTexture: true })
      appRef.current = null
    }

    const container = containerRef.current
    if (!container) return

    try {
      const app = new PIXI.Application({
        backgroundAlpha: 0,
        width: container.clientWidth || 600,
        height: container.clientHeight || 500,
        antialias: true,
        resolution: 1,
      })

      // @ts-expect-error PixiJS v7
      container.appendChild(app.view)
      const canvas = app.view as HTMLCanvasElement
      canvas.style.display = 'block'
      appRef.current = app

      // CDN URL からモデルを読み込み
      const cdnBase = MODELS_CDN_BASE || 'https://d10pmg1gpcr0qb.cloudfront.net'
      const modelUrl = `${cdnBase}/${model.s3Prefix}${model.modelFile}`
      console.log('[ModelPreview] Loading model from:', modelUrl)

      const live2dModel = await Live2DModel.from(modelUrl, {
        autoInteract: false,
        autoUpdate: true,
      })

      modelRef.current = live2dModel

      // スケール・位置を調整
      live2dModel.anchor.set(0.5, 0.5)
      const w = container.clientWidth
      const h = container.clientHeight
      const fitScale = Math.min(w / live2dModel.width, h / live2dModel.height)
      const scale = Math.min(fitScale, 0.5)
      live2dModel.scale.set(scale)
      live2dModel.x = w / 2
      live2dModel.y = h / 2

      app.stage.addChild(live2dModel)
      setModelLoading(false)
    } catch (err) {
      console.error('[ModelPreview] Load error:', err)
      setModelError(err instanceof Error ? err.message : 'モデル読み込みエラー')
      setModelLoading(false)
    }
  }, [])

  /** 表情を再生 */
  const playExpression = useCallback((name: string) => {
    const model = modelRef.current
    if (!model) return
    try {
      ;(model as any).expression(name)
      setActiveExpression(name)
    } catch (e) {
      console.warn('Expression error:', e)
    }
  }, [])

  /** モーションを再生 */
  const playMotion = useCallback((group: string, index: number, label: string) => {
    const model = modelRef.current
    if (!model) return
    try {
      const motionManager = (model as any).internalModel?.motionManager
      if (motionManager) {
        motionManager.startMotion(group, index)
        setActiveMotion(label)
      }
    } catch (e) {
      console.warn('Motion error:', e)
    }
  }, [])

  /** クリーンアップ */
  useEffect(() => {
    return () => {
      if (modelRef.current) modelRef.current.destroy()
      if (appRef.current) appRef.current.destroy(true, { children: true, texture: true, baseTexture: true })
    }
  }, [])

  return (
    <div className="p-6 max-w-6xl">
      <h2 className="text-xl font-bold mb-6">モデルプレビュー</h2>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded text-sm">
          {error}
          <button onClick={() => setError('')} className="ml-2 text-red-500 hover:text-red-700">×</button>
        </div>
      )}

      {/* モデル選択 */}
      <div className="mb-4">
        <label className="text-sm font-medium text-gray-600 mr-3">モデル選択:</label>
        {isLoading ? (
          <span className="text-sm text-gray-400">読み込み中...</span>
        ) : (
          <select
            value={selectedModel?.modelId ?? ''}
            onChange={(e) => {
              const m = models.find((m) => m.modelId === e.target.value)
              if (m) loadModel(m)
            }}
            className="px-3 py-2 border border-gray-300 rounded text-sm"
          >
            <option value="">選択してください</option>
            {models.map((m) => (
              <option key={m.modelId} value={m.modelId}>
                {m.name} ({m.status})
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex gap-6">
        {/* Live2D 表示エリア */}
        <div className="flex-1">
          <div
            ref={containerRef}
            className="w-full bg-gradient-to-b from-gray-100 to-gray-200 rounded-lg border border-gray-300 relative overflow-hidden flex items-center justify-center"
            style={{ height: '500px' }}
          >
            {!selectedModel && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
                モデルを選択してください
              </div>
            )}
            {modelLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80">
                <span className="text-sm text-gray-500">モデル読み込み中...</span>
              </div>
            )}
            {modelError && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-sm text-red-500 bg-red-50 p-3 rounded">{modelError}</div>
              </div>
            )}
          </div>

          {/* 現在の状態 */}
          {selectedModel && (
            <div className="mt-2 flex gap-4 text-xs text-gray-500">
              <span>表情: <span className="font-medium text-gray-700">{activeExpression || '(デフォルト)'}</span></span>
              <span>モーション: <span className="font-medium text-gray-700">{activeMotion || '(なし)'}</span></span>
            </div>
          )}
        </div>

        {/* コントロールパネル */}
        {selectedModel && (
          <div className="w-72 space-y-4 overflow-y-auto" style={{ maxHeight: '540px' }}>
            {/* 感情マッピングテスト */}
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <h3 className="text-sm font-medium mb-2">感情 → 表情テスト</h3>
              <p className="text-xs text-gray-400 mb-2">マッピングに基づいて表情を切り替えます</p>
              <div className="space-y-1">
                {Object.entries(selectedModel.emotionMapping).map(([emotion, expression]) => (
                  <button
                    key={emotion}
                    onClick={() => playExpression(expression)}
                    className={`w-full text-left px-2 py-1.5 text-xs rounded hover:bg-blue-50 flex justify-between items-center ${
                      activeExpression === expression ? 'bg-blue-100 text-blue-700' : 'text-gray-700'
                    }`}
                  >
                    <span className="font-medium">{emotion}</span>
                    <span className="text-gray-400">→ {expression}</span>
                  </button>
                ))}
                {Object.keys(selectedModel.emotionMapping).length === 0 && (
                  <p className="text-xs text-gray-400">マッピング未設定</p>
                )}
              </div>
            </div>

            {/* モーションマッピングテスト */}
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <h3 className="text-sm font-medium mb-2">モーションタグ → モーションテスト</h3>
              <p className="text-xs text-gray-400 mb-2">マッピングに基づいてモーションを再生します</p>
              <div className="space-y-1">
                {Object.entries(selectedModel.motionMapping).map(([tag, def]) => (
                  <button
                    key={tag}
                    onClick={() => playMotion(def.group, def.index, tag)}
                    className={`w-full text-left px-2 py-1.5 text-xs rounded hover:bg-green-50 flex justify-between items-center ${
                      activeMotion === tag ? 'bg-green-100 text-green-700' : 'text-gray-700'
                    }`}
                  >
                    <span className="font-medium">{tag}</span>
                    <span className="text-gray-400">→ {def.group}[{def.index}]</span>
                  </button>
                ))}
                {Object.keys(selectedModel.motionMapping).length === 0 && (
                  <p className="text-xs text-gray-400">マッピング未設定</p>
                )}
              </div>
            </div>

            {/* 直接テスト（全表情・全モーション） */}
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <h3 className="text-sm font-medium mb-2">全表情（直接再生）</h3>
              <div className="flex flex-wrap gap-1">
                {selectedModel.expressions.map((exp) => (
                  <button
                    key={exp.name}
                    onClick={() => playExpression(exp.name)}
                    className={`px-2 py-1 text-xs rounded border ${
                      activeExpression === exp.name
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {exp.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <h3 className="text-sm font-medium mb-2">全モーション（直接再生）</h3>
              <div className="flex flex-wrap gap-1">
                {selectedModel.motions.map((m) => (
                  <button
                    key={`${m.group}|${m.index}`}
                    onClick={() => playMotion(m.group, m.index, `${m.group}[${m.index}]`)}
                    className={`px-2 py-1 text-xs rounded border ${
                      activeMotion === `${m.group}[${m.index}]`
                        ? 'bg-green-600 text-white border-green-600'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {m.group || '(default)'}[{m.index}]
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
