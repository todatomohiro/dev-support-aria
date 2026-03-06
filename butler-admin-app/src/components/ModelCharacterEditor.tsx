import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router'
import { adminApi } from '@/services/adminApi'
import { useAuthStore } from '@/auth/authStore'
import type { ModelMeta, CharacterConfig } from '@/types/admin'

const EMPTY_CONFIG: CharacterConfig = {
  characterName: '',
  characterAge: '',
  characterGender: '',
  characterPersonality: '',
  characterSpeechStyle: '',
  characterPrompt: '',
}

/**
 * モデルキャラクター個性設定ページ
 *
 * キャラクター名・年齢・性別・性格・口調・カスタムプロンプトを編集する。
 */
export function ModelCharacterEditor() {
  const { modelId } = useParams<{ modelId: string }>()
  const navigate = useNavigate()
  const token = useAuthStore((s) => s.idToken)

  const [model, setModel] = useState<ModelMeta | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const [config, setConfig] = useState<CharacterConfig>(EMPTY_CONFIG)
  const [savedConfig, setSavedConfig] = useState<CharacterConfig>(EMPTY_CONFIG)
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')

  const isDirty = JSON.stringify(config) !== JSON.stringify(savedConfig)

  /** モデルメタデータを取得 */
  const loadModel = useCallback(async () => {
    if (!token || !modelId) return
    setIsLoading(true)
    setError('')
    try {
      const res = await adminApi.listModels(token)
      const found = res.models.find((m) => m.modelId === modelId)
      if (!found) {
        setError('モデルが見つかりません')
        return
      }
      setModel(found)
      const loaded = found.characterConfig ?? EMPTY_CONFIG
      setConfig(loaded)
      setSavedConfig(loaded)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'モデル取得エラー')
    } finally {
      setIsLoading(false)
    }
  }, [token, modelId])

  useEffect(() => {
    loadModel()
  }, [loadModel])

  /** フィールド更新 */
  const updateField = <K extends keyof CharacterConfig>(key: K, value: CharacterConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
    setSaveMessage('')
  }

  /** 保存 */
  const handleSave = async () => {
    if (!token || !modelId || !isDirty) return
    setIsSaving(true)
    setSaveMessage('')
    try {
      await adminApi.updateModel(token, modelId, { characterConfig: config })
      setSavedConfig(config)
      setSaveMessage('保存しました')
    } catch (e) {
      setSaveMessage(`保存エラー: ${e instanceof Error ? e.message : '不明'}`)
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-red-500">{error}</p>
        <button onClick={() => navigate('/models')} className="mt-4 text-sm text-blue-600 hover:underline">
          ← モデル一覧に戻る
        </button>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl">
      {/* ヘッダー */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => navigate('/models')} className="text-sm text-blue-600 hover:underline">
          ← モデル一覧
        </button>
        <h2 className="text-xl font-bold">キャラクター設定: {model?.name}</h2>
      </div>

      {/* フォーム */}
      <div className="space-y-6 bg-white rounded-lg border border-gray-200 p-6">
        {/* キャラクター名（モデル説明用） */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            キャラクター名
            <span className="ml-2 text-xs text-gray-400 font-normal">（モデルの説明用。AIの呼び名はユーザーが設定します）</span>
          </label>
          <input
            type="text"
            value={config.characterName}
            onChange={(e) => updateField('characterName', e.target.value)}
            maxLength={50}
            placeholder="例: 元気な女の子キャラ"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-400">{config.characterName.length}/50</p>
        </div>

        {/* 年齢・性別 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">年齢</label>
            <input
              type="text"
              value={config.characterAge}
              onChange={(e) => updateField('characterAge', e.target.value)}
              maxLength={10}
              placeholder="例: 18歳"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">性別</label>
            <select
              value={config.characterGender}
              onChange={(e) => updateField('characterGender', e.target.value as CharacterConfig['characterGender'])}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">未設定</option>
              <option value="female">女性</option>
              <option value="male">男性</option>
              <option value="other">その他</option>
            </select>
          </div>
        </div>

        {/* 性格・特徴 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">性格・特徴</label>
          <textarea
            value={config.characterPersonality}
            onChange={(e) => updateField('characterPersonality', e.target.value)}
            maxLength={500}
            rows={4}
            placeholder="例: 明るく元気。負けず嫌いでちょっと天然。お調子者で落ち着きがない。"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-vertical"
          />
          <p className="mt-1 text-xs text-gray-400">{config.characterPersonality.length}/500</p>
        </div>

        {/* 話し方・口調 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">話し方・口調</label>
          <textarea
            value={config.characterSpeechStyle}
            onChange={(e) => updateField('characterSpeechStyle', e.target.value)}
            maxLength={500}
            rows={4}
            placeholder="例: タメ口で親しみやすく話す。「〜だよ！」「〜だね！」「〜かな？」を使う。ユーザーのことは呼び捨てか「きみ」と呼ぶ。"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-vertical"
          />
          <p className="mt-1 text-xs text-gray-400">{config.characterSpeechStyle.length}/500</p>
        </div>

        {/* カスタムプロンプト */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            カスタムプロンプト
            <span className="ml-2 text-xs text-gray-400 font-normal">（上級者向け：自由記述でシステムプロンプトに追加）</span>
          </label>
          <textarea
            value={config.characterPrompt}
            onChange={(e) => updateField('characterPrompt', e.target.value)}
            maxLength={2000}
            rows={6}
            placeholder="例: 嬉しいときは素直に喜ぶ。「やったー！」「すごい！」。わからないことは正直に言う。絵文字や記号は使わない。"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-vertical font-mono"
          />
          <p className="mt-1 text-xs text-gray-400">{config.characterPrompt.length}/2000</p>
        </div>

        {/* 保存ボタン */}
        <div className="flex items-center gap-4 pt-2">
          <button
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            className={`px-6 py-2 rounded-md text-sm font-medium text-white ${
              isDirty && !isSaving ? 'bg-blue-600 hover:bg-blue-700 cursor-pointer' : 'bg-gray-300 cursor-not-allowed'
            }`}
          >
            {isSaving ? '保存中...' : '保存'}
          </button>
          {saveMessage && (
            <span className={`text-sm ${saveMessage.startsWith('保存エラー') ? 'text-red-500' : 'text-green-600'}`}>
              {saveMessage}
            </span>
          )}
          {isDirty && !saveMessage && (
            <span className="text-sm text-orange-500">未保存の変更があります</span>
          )}
        </div>
      </div>
    </div>
  )
}
