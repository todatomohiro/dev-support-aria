import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { useAuthStore } from '@/auth/authStore'
import { useAppStore } from '@/stores'
import { modelService } from '@/services/modelService'
import { elevenLabsTtsService } from '@/services/elevenLabsTtsService'
import type { ServerModel } from '@/services/modelService'
import type { ModelReference } from '@/types'

/**
 * マイAi-Ba(α) — 音声会話機能のエントリーポイント
 *
 * Live2D キャラクター表示 + 「話しかける」ボタン + キャラクター選択。
 * 既存の AibaScreen（マイAi-Ba）には影響を与えない独立画面。
 */
export function AibaAlphaScreen() {
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
      console.error('[AibaAlpha] モデル一覧取得エラー:', error)
    } finally {
      setIsLoading(false)
    }
  }, [authStatus])

  useEffect(() => {
    loadModels()
  }, [loadModels])

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
    await elevenLabsTtsService.unlockAudio()
    navigate('/aiba-alpha/voice')
  }

  if (authStatus !== 'authenticated') {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <p className="text-sm text-gray-500 dark:text-gray-400">ログインすると音声会話機能が使えます</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      {/* Live2D エリア */}
      <div className="h-[240px] sm:h-[280px] bg-gradient-to-b from-blue-50 to-purple-50 dark:from-gray-800 dark:to-gray-900 flex items-center justify-center relative shrink-0">
        {/* TODO: Live2D キャンバスをここに配置 */}
        <div className="w-28 h-44 bg-black/5 dark:bg-white/5 rounded-[56px_56px_28px_28px]" />
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-white/90 dark:bg-gray-700/90 backdrop-blur-sm rounded-full px-4 py-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
          {serverModels.find((m) => m.modelId === config.model.selectedModelId)?.name ?? 'キャラクター'}
        </div>

        {/* αバッジ */}
        <div className="absolute top-3 right-3 bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
          α
        </div>
      </div>

      {/* 話しかけるボタン */}
      <div className="px-4 pt-5 pb-3">
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
      <div className="px-4 pb-6">
        <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 mb-3">キャラクター選択</h3>
        {isLoading ? (
          <p className="text-xs text-gray-400">読み込み中...</p>
        ) : serverModels.length === 0 ? (
          <p className="text-xs text-gray-400">利用可能なキャラクターがありません</p>
        ) : (
          <>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
              {serverModels.map((model) => {
                const isSelected = selectedModelId === model.modelId
                const isInUse = config.model.selectedModelId === model.modelId
                return (
                  <button
                    key={model.modelId}
                    onClick={() => setSelectedModelId(model.modelId)}
                    className={`text-left rounded-2xl border-2 overflow-hidden transition-all bg-white dark:bg-gray-800 ${
                      isSelected
                        ? 'border-blue-500 shadow-md ring-2 ring-blue-500/20'
                        : 'border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-700'
                    }`}
                  >
                    <div className="relative h-20 sm:h-24 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-gray-700 dark:to-gray-800 flex items-center justify-center">
                      <div className="w-9 h-12 bg-black/5 dark:bg-white/5 rounded-[18px_18px_10px_10px]" />
                      {isInUse && (
                        <span className="absolute top-1.5 right-1.5 bg-green-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                          使用中
                        </span>
                      )}
                    </div>
                    <div className="p-2">
                      <div className="text-[11px] font-semibold text-gray-900 dark:text-gray-100 truncate">{model.name}</div>
                    </div>
                  </button>
                )
              })}
            </div>

            {isDirty && (
              <div className="mt-4">
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold rounded-xl shadow-lg transition-colors text-sm"
                >
                  {isSaving ? '変更中...' : 'このキャラクターに変更'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
