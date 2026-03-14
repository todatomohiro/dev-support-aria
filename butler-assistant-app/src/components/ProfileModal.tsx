import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '@/auth/authStore'
import { modelService } from '@/services/modelService'
import { useAppStore } from '@/stores'
import type { ServerModel } from '@/services/modelService'
import type { UserProfile } from '@/types'

interface ProfileModalProps {
  isOpen: boolean
  onClose: () => void
  profile: UserProfile
  onSave: (profile: Partial<UserProfile>) => void
}

/**
 * プロフィール設定モーダル コンポーネント
 */
export function ProfileModal({ isOpen, onClose, profile, onSave }: ProfileModalProps) {
  const authStatus = useAuthStore((s) => s.status)
  const config = useAppStore((s) => s.config)
  const updateConfig = useAppStore((s) => s.updateConfig)
  const setActiveModelMeta = useAppStore((s) => s.setActiveModelMeta)

  const [nickname, setNickname] = useState(profile.nickname)
  const [honorific, setHonorific] = useState<UserProfile['honorific']>(profile.honorific)
  const [gender, setGender] = useState<UserProfile['gender']>(profile.gender)
  const [aiName, setAiName] = useState(profile.aiName ?? '')
  const [isSaving, setIsSaving] = useState(false)

  // キャラクターモデル選択
  const [standardModels, setStandardModels] = useState<ServerModel[]>([])
  const [selectedModelId, setSelectedModelId] = useState(config.model.selectedModelId ?? '')
  const [isLoadingModels, setIsLoadingModels] = useState(false)

  const loadModels = useCallback(async () => {
    if (authStatus !== 'authenticated') return
    setIsLoadingModels(true)
    try {
      const models = await modelService.listModels()
      setStandardModels(models.filter((m) => (m.modelTier ?? 'standard') === 'standard'))
    } catch (err) {
      console.error('[ProfileModal] モデル取得エラー:', err)
    } finally {
      setIsLoadingModels(false)
    }
  }, [authStatus])

  // 設定が変更された時にローカル状態を更新
  useEffect(() => {
    setNickname(profile.nickname)
    setHonorific(profile.honorific)
    setGender(profile.gender)
    setAiName(profile.aiName ?? '')
  }, [profile])

  // モーダルが開いた時にモデル一覧を取得
  useEffect(() => {
    if (isOpen) {
      loadModels()
      setSelectedModelId(config.model.selectedModelId ?? '')
    }
  }, [isOpen, loadModels, config.model.selectedModelId])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      onSave({ nickname, honorific, gender, aiName })

      // モデル選択が変わった場合はモデルも更新
      if (selectedModelId !== (config.model.selectedModelId ?? '')) {
        const selected = standardModels.find((m) => m.modelId === selectedModelId)
        if (selected) {
          updateConfig({
            model: {
              ...config.model,
              selectedModelId,
              currentModelId: selected.modelUrl || config.model.currentModelId,
            },
          })
          setActiveModelMeta({
            modelId: selected.modelId,
            emotionMapping: selected.emotionMapping,
            motionMapping: selected.motionMapping,
          })
        }
      }

      onClose()
    } catch (error) {
      console.error('プロフィールの保存に失敗:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setNickname(profile.nickname)
    setHonorific(profile.honorific)
    setGender(profile.gender)
    setAiName(profile.aiName ?? '')
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      data-testid="profile-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancel()
      }}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden"
        data-testid="profile-panel"
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            プロフィール
          </h2>
          <button
            onClick={handleCancel}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
            data-testid="profile-close-button"
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
          <div className="space-y-4">
            {/* ニックネーム */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                ニックネーム
              </label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value.slice(0, 20))}
                maxLength={20}
                placeholder="名前を入力"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                data-testid="nickname-input"
              />
            </div>

            {/* 敬称 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                敬称
              </label>
              <select
                value={honorific}
                onChange={(e) => setHonorific(e.target.value as UserProfile['honorific'])}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                data-testid="honorific-select"
              >
                <option value="">なし</option>
                <option value="さん">さん</option>
                <option value="くん">くん</option>
                <option value="様">様</option>
              </select>
            </div>

            {/* 性別 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                性別
              </label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value as UserProfile['gender'])}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                data-testid="gender-select"
              >
                <option value="">未設定</option>
                <option value="female">女性</option>
                <option value="male">男性</option>
              </select>
            </div>

            {/* AIネーム */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                AIネーム
              </label>
              <input
                type="text"
                value={aiName}
                onChange={(e) => setAiName(e.target.value.slice(0, 20))}
                maxLength={20}
                placeholder="AIの名前を入力"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                data-testid="ai-name-input"
              />
            </div>

            {/* キャラクター選択 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                キャラクター
              </label>
              {isLoadingModels ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">読み込み中...</p>
              ) : standardModels.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">利用可能なキャラクターがありません</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {standardModels.map((model) => {
                    const isSelected = selectedModelId === model.modelId
                    return (
                      <button
                        key={model.modelId}
                        type="button"
                        onClick={() => setSelectedModelId(model.modelId)}
                        className={`flex flex-col items-center p-2.5 rounded-xl border-2 transition-all ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                            : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-500'
                        }`}
                        data-testid={`profile-model-${model.modelId}`}
                      >
                        <div className="w-12 h-[60px] rounded-[24px_24px_12px_12px] overflow-hidden bg-gray-100 dark:bg-gray-700 flex items-center justify-center mb-1.5">
                          {model.avatarUrl ? (
                            <img src={model.avatarUrl} alt={model.name} className="w-full h-full object-cover" />
                          ) : (
                            <svg className="w-6 h-6 text-gray-300 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                          )}
                        </div>
                        <span className={`text-[11px] font-medium text-center line-clamp-1 ${
                          isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-300'
                        }`}>
                          {model.name}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* 選択中キャラクターの詳細 */}
              {(() => {
                const selected = standardModels.find((m) => m.modelId === selectedModelId)
                const cc = selected?.characterConfig
                if (!selected || !cc) return null
                const genderLabel = cc.characterGender === 'female' ? '女性' : cc.characterGender === 'male' ? '男性' : cc.characterGender === 'other' ? 'その他' : ''
                return (
                  <div className="mt-3 p-3 rounded-lg bg-blue-50/60 dark:bg-blue-900/20 border border-blue-200/50 dark:border-blue-800/30">
                    <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1.5">
                      {cc.characterName || selected.name}
                      <span className="text-[10px] font-medium text-blue-500 dark:text-blue-400 ml-1.5 px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/40 rounded">モデル</span>
                      {(cc.characterAge || genderLabel) && (
                        <span className="text-xs font-normal text-gray-500 dark:text-gray-400 ml-1">
                          ({[cc.characterAge, genderLabel].filter(Boolean).join(' / ')})
                        </span>
                      )}
                    </div>
                    {cc.characterPersonality && (
                      <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed line-clamp-3">
                        {cc.characterPersonality}
                      </p>
                    )}
                  </div>
                )
              })()}
            </div>
          </div>
        </div>

        {/* フッター */}
        <div className="flex justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
            data-testid="profile-cancel-button"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
            data-testid="profile-save-button"
          >
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
