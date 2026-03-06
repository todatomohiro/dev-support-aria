import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router'
import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import { adminApi } from '@/services/adminApi'
import { useAuthStore } from '@/auth/authStore'
import type { ModelMeta } from '@/types/admin'

if (typeof window !== 'undefined') {
  ;(window as any).PIXI = PIXI
}

/** 感情名の選択肢と日本語訳 */
const EMOTION_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'neutral', label: 'neutral（通常）' },
  { key: 'happy', label: 'happy（喜び）' },
  { key: 'thinking', label: 'thinking（考え中）' },
  { key: 'surprised', label: 'surprised（驚き）' },
  { key: 'sad', label: 'sad（悲しみ）' },
  { key: 'embarrassed', label: 'embarrassed（照れ）' },
  { key: 'troubled', label: 'troubled（困惑）' },
  { key: 'angry', label: 'angry（怒り）' },
  { key: 'error', label: 'error（エラー）' },
]

/** モーションタグの選択肢と日本語訳 */
const MOTION_TAG_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'idle', label: 'idle（待機）' },
  { key: 'happy', label: 'happy（喜び）' },
  { key: 'thinking', label: 'thinking（考え中）' },
  { key: 'surprised', label: 'surprised（驚き）' },
  { key: 'sad', label: 'sad（悲しみ）' },
  { key: 'embarrassed', label: 'embarrassed（照れ）' },
  { key: 'troubled', label: 'troubled（困惑）' },
  { key: 'angry', label: 'angry（怒り）' },
  { key: 'error', label: 'error（エラー）' },
  { key: 'motion1', label: 'motion1（モーション1）' },
  { key: 'motion2', label: 'motion2（モーション2）' },
  { key: 'motion3', label: 'motion3（モーション3）' },
  { key: 'motion4', label: 'motion4（モーション4）' },
  { key: 'motion5', label: 'motion5（モーション5）' },
  { key: 'motion6', label: 'motion6（モーション6）' },
]

const MODELS_CDN_BASE = import.meta.env.VITE_MODELS_CDN_BASE as string | undefined

/**
 * モデルマッピング設定ページ
 *
 * Live2D プレビュー付きで感情/モーションマッピングを編集・テストする。
 */
export function ModelMappingEditor() {
  const { modelId } = useParams<{ modelId: string }>()
  const navigate = useNavigate()
  const token = useAuthStore((s) => s.idToken)

  const [model, setModel] = useState<ModelMeta | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  // マッピング編集状態
  const [emotionMapping, setEmotionMapping] = useState<Record<string, string>>({})
  const [motionMapping, setMotionMapping] = useState<Record<string, { group: string; index: number }>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  // Live2D
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<PIXI.Application | null>(null)
  const live2dModelRef = useRef<Live2DModel | null>(null)
  const [modelLoaded, setModelLoaded] = useState(false)
  const [modelError, setModelError] = useState('')

  // テスト状態
  const [activeExpression, setActiveExpression] = useState('')
  const [activeMotion, setActiveMotion] = useState('')

  /** モデル情報を読み込み */
  useEffect(() => {
    if (!token || !modelId) return
    setIsLoading(true)
    adminApi.listModels(token)
      .then((result) => {
        const found = result.models.find((m) => m.modelId === modelId)
        if (found) {
          setModel(found)
          setEmotionMapping({ ...found.emotionMapping })
          setMotionMapping({ ...found.motionMapping })
        } else {
          setError('モデルが見つかりません')
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : '読み込みエラー'))
      .finally(() => setIsLoading(false))
  }, [token, modelId])

  /** Live2D モデルを読み込み */
  useEffect(() => {
    if (!model) return
    const container = containerRef.current
    if (!container) return

    let isMounted = true

    const init = async () => {
      // 既存を破棄
      if (live2dModelRef.current) {
        live2dModelRef.current.destroy()
        live2dModelRef.current = null
      }
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true, baseTexture: true })
        appRef.current = null
      }

      try {
        const w = container.clientWidth || 400
        const h = container.clientHeight || 500

        const app = new PIXI.Application({
          backgroundAlpha: 0,
          width: w,
          height: h,
          antialias: true,
          resolution: 1,
        })

        // @ts-expect-error PixiJS v7
        container.appendChild(app.view)
        appRef.current = app

        const cdnBase = MODELS_CDN_BASE || 'https://d10pmg1gpcr0qb.cloudfront.net'
        const modelUrl = `${cdnBase}/${model.s3Prefix}${model.modelFile}`

        const live2d = await Live2DModel.from(modelUrl, {
          autoInteract: false,
          autoUpdate: true,
        })

        if (!isMounted) {
          live2d.destroy()
          return
        }

        live2dModelRef.current = live2d
        live2d.anchor.set(0.5, 0.5)

        const fitScale = Math.min(w / live2d.width, h / live2d.height)
        const scale = Math.min(fitScale, 0.5)
        live2d.scale.set(scale)
        live2d.x = w / 2
        live2d.y = h / 2

        app.stage.addChild(live2d)
        setModelLoaded(true)
      } catch (err) {
        if (isMounted) setModelError(err instanceof Error ? err.message : 'モデル読み込みエラー')
      }
    }

    init()

    return () => {
      isMounted = false
      if (live2dModelRef.current) live2dModelRef.current.destroy()
      if (appRef.current) appRef.current.destroy(true, { children: true, texture: true, baseTexture: true })
      live2dModelRef.current = null
      appRef.current = null
      setModelLoaded(false)
    }
  }, [model])

  /** 表情を再生 */
  const playExpression = useCallback((name: string) => {
    const m = live2dModelRef.current
    if (!m) return
    try {
      ;(m as any).expression(name)
      setActiveExpression(name)
    } catch (e) {
      console.warn('Expression error:', e)
    }
  }, [])

  /** モーションを再生 */
  const playMotion = useCallback((group: string, index: number) => {
    const m = live2dModelRef.current
    if (!m) return
    try {
      const motionManager = (m as any).internalModel?.motionManager
      if (motionManager) {
        motionManager.startMotion(group, index)
      }
    } catch (e) {
      console.warn('Motion error:', e)
    }
  }, [])

  /** 感情マッピングを変更 */
  const updateEmotionMapping = useCallback((emotion: string, expression: string) => {
    setEmotionMapping((prev) => {
      const next = { ...prev }
      if (expression) {
        next[emotion] = expression
      } else {
        delete next[emotion]
      }
      return next
    })
    setIsDirty(true)
  }, [])

  /** モーションマッピングを変更 */
  const updateMotionMapping = useCallback((tag: string, value: string) => {
    setMotionMapping((prev) => {
      const next = { ...prev }
      if (value) {
        const parts = value.split('|')
        next[tag] = { group: parts[0] ?? '', index: parseInt(parts[1] ?? '0', 10) }
      } else {
        delete next[tag]
      }
      return next
    })
    setIsDirty(true)
  }, [])

  /** マッピングを保存 */
  const handleSave = useCallback(async () => {
    if (!token || !modelId) return
    setIsSaving(true)
    try {
      await adminApi.updateModel(token, modelId, { emotionMapping, motionMapping })
      setIsDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setIsSaving(false)
    }
  }, [token, modelId, emotionMapping, motionMapping])

  if (isLoading) {
    return <div className="p-6 text-sm text-gray-500">読み込み中...</div>
  }

  if (!model) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-500 mb-4">{error || 'モデルが見つかりません'}</p>
        <button onClick={() => navigate('/models')} className="text-sm text-blue-600 hover:underline">← モデル一覧に戻る</button>
      </div>
    )
  }

  return (
    <div className="p-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/models')} className="text-sm text-gray-500 hover:text-gray-700">← 一覧</button>
          <h2 className="text-xl font-bold">{model.name}</h2>
          <span className="text-xs text-gray-400">マッピング設定</span>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && <span className="text-xs text-orange-500">未保存の変更があります</span>}
          <button
            onClick={handleSave}
            disabled={isSaving || !isDirty}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded text-sm">
          {error}
          <button onClick={() => setError('')} className="ml-2 text-red-500 hover:text-red-700">×</button>
        </div>
      )}

      <div className="flex gap-6">
        {/* 左: Live2D プレビュー */}
        <div className="w-[400px] flex-shrink-0">
          <div
            ref={containerRef}
            className="bg-gradient-to-b from-gray-100 to-gray-200 rounded-lg border border-gray-300 relative overflow-hidden"
            style={{ width: 400, height: 500 }}
          >
            {!modelLoaded && !modelError && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm text-gray-500">モデル読み込み中...</span>
              </div>
            )}
            {modelError && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-sm text-red-500 bg-red-50 p-3 rounded">{modelError}</div>
              </div>
            )}
          </div>
          <div className="mt-2 flex gap-4 text-xs text-gray-500">
            <span>表情: <span className="font-medium text-gray-700">{activeExpression || '(デフォルト)'}</span></span>
            <span>モーション: <span className="font-medium text-gray-700">{activeMotion || '(なし)'}</span></span>
          </div>
        </div>

        {/* 右: マッピング設定 */}
        <div className="flex-1 space-y-6">
          {/* 感情→表情マッピング */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-medium mb-1">感情 → 表情</h3>
            <p className="text-xs text-gray-400 mb-3">LLM の emotion 値をモデルの表情に紐付けます。右のボタンでテスト再生できます。</p>
            <div className="space-y-2">
              {EMOTION_OPTIONS.map(({ key, label }) => {
                const mapped = emotionMapping[key]
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 w-40 flex-shrink-0">{label}</span>
                    <select
                      value={mapped ?? ''}
                      onChange={(e) => updateEmotionMapping(key, e.target.value)}
                      className="px-2 py-1 border border-gray-300 rounded text-sm flex-1 min-w-0"
                    >
                      <option value="">（未設定）</option>
                      {model.expressions.map((exp) => (
                        <option key={exp.name} value={exp.name}>{exp.name} ({exp.file})</option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        if (mapped) {
                          playExpression(mapped)
                          setActiveExpression(mapped)
                        }
                      }}
                      disabled={!mapped || !modelLoaded}
                      className={`px-2 py-1 text-xs rounded flex-shrink-0 ${
                        activeExpression === mapped
                          ? 'bg-blue-600 text-white'
                          : 'bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-30 disabled:hover:bg-blue-50'
                      }`}
                    >
                      テスト
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* モーションタグ→モーションマッピング */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-medium mb-1">モーションタグ → モーション</h3>
            <p className="text-xs text-gray-400 mb-3">アプリ内のモーションタグをモデルのモーションに紐付けます。右のボタンでテスト再生できます。</p>
            <div className="space-y-2">
              {MOTION_TAG_OPTIONS.map(({ key, label }) => {
                const mapped = motionMapping[key]
                const mappedValue = mapped ? `${mapped.group}|${mapped.index}` : ''
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 w-40 flex-shrink-0">{label}</span>
                    <select
                      value={mappedValue}
                      onChange={(e) => updateMotionMapping(key, e.target.value)}
                      className="px-2 py-1 border border-gray-300 rounded text-sm flex-1 min-w-0"
                    >
                      <option value="">（未設定）</option>
                      {model.motions.map((m) => (
                        <option key={`${m.group}|${m.index}`} value={`${m.group}|${m.index}`}>
                          {m.group || '(default)'}[{m.index}] — {m.file}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        if (mapped) {
                          playMotion(mapped.group, mapped.index)
                          setActiveMotion(key)
                        }
                      }}
                      disabled={!mapped || !modelLoaded}
                      className={`px-2 py-1 text-xs rounded flex-shrink-0 ${
                        activeMotion === key
                          ? 'bg-green-600 text-white'
                          : 'bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-30 disabled:hover:bg-green-50'
                      }`}
                    >
                      テスト
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 全表情・全モーション直接テスト */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-medium mb-2">全表情（直接再生）</h3>
            <div className="flex flex-wrap gap-1">
              {model.expressions.map((exp) => (
                <button
                  key={exp.name}
                  onClick={() => { playExpression(exp.name); setActiveExpression(exp.name) }}
                  disabled={!modelLoaded}
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

          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-medium mb-2">全モーション（直接再生）</h3>
            <div className="flex flex-wrap gap-1">
              {model.motions.map((m) => {
                const label = `${m.group || '(default)'}[${m.index}]`
                return (
                  <button
                    key={`${m.group}|${m.index}`}
                    onClick={() => { playMotion(m.group, m.index); setActiveMotion(label) }}
                    disabled={!modelLoaded}
                    className={`px-2 py-1 text-xs rounded border ${
                      activeMotion === label
                        ? 'bg-green-600 text-white border-green-600'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
