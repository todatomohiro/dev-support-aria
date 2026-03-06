import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '@/auth/authStore'
import { modelService } from '@/services/modelService'
import type { ServerModel } from '@/services/modelService'
import type { ModelReference } from '@/types'

interface AibaModalProps {
  isOpen: boolean
  onClose: () => void
  config: {
    model: ModelReference
  }
  onSave: (model: Partial<ModelReference>, selectedModel?: ServerModel) => void
}

/**
 * Ai-Ba（アイバ）設定モーダル
 *
 * キャラクター（モデル）の選択を行う専用画面。
 */
export function AibaModal({ isOpen, onClose, config, onSave }: AibaModalProps) {
  const authStatus = useAuthStore((s) => s.status)

  const [serverModels, setServerModels] = useState<ServerModel[]>([])
  const [selectedModelId, setSelectedModelId] = useState<string>(config.model.selectedModelId ?? '')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const isDirty = selectedModelId !== (config.model.selectedModelId ?? '')

  // モデル一覧を取得
  const loadModels = useCallback(async () => {
    if (authStatus !== 'authenticated') return
    setIsLoading(true)
    try {
      const models = await modelService.listModels()
      setServerModels(models)
    } catch (error) {
      console.error('[AibaModal] モデル一覧取得エラー:', error)
    } finally {
      setIsLoading(false)
    }
  }, [authStatus])

  useEffect(() => {
    if (isOpen) {
      loadModels()
      setSelectedModelId(config.model.selectedModelId ?? '')
    }
  }, [isOpen, loadModels, config.model.selectedModelId])

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
      onSave(modelUpdate, selected)
      onClose()
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setSelectedModelId(config.model.selectedModelId ?? '')
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancel()
      }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden">
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Ai-Ba
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              キャラクターを選択
            </p>
          </div>
          <button
            onClick={handleCancel}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* コンテンツ */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {authStatus !== 'authenticated' ? (
            <p className="text-sm text-gray-500">ログインするとキャラクターを選択できます</p>
          ) : isLoading ? (
            <p className="text-sm text-gray-500">読み込み中...</p>
          ) : serverModels.length === 0 ? (
            <p className="text-sm text-gray-500">利用可能なキャラクターがありません</p>
          ) : (
            <div className="space-y-2">
              {serverModels.map((model) => (
                <label
                  key={model.modelId}
                  className={`flex items-center p-4 rounded-lg border cursor-pointer transition-colors ${
                    selectedModelId === model.modelId
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="aibaModel"
                    value={model.modelId}
                    checked={selectedModelId === model.modelId}
                    onChange={() => setSelectedModelId(model.modelId)}
                    className="mr-3 text-blue-600"
                  />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {model.name}
                    </span>
                    {model.description && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {model.description}
                      </p>
                    )}
                  </div>
                  {selectedModelId === model.modelId && (
                    <svg className="w-5 h-5 text-blue-500 shrink-0 ml-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  )}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="flex justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            className={`px-4 py-2 rounded-lg text-white ${
              isDirty && !isSaving ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-400 cursor-not-allowed'
            }`}
          >
            {isSaving ? '保存中...' : '変更を保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
