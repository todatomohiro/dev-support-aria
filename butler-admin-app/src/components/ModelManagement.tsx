import { useState, useEffect, useCallback, useRef } from 'react'
import { adminApi } from '@/services/adminApi'
import { useAuthStore } from '@/auth/authStore'
import type { ModelMeta } from '@/types/admin'

/** 感情名の選択肢（LLM が返す emotion フィールド値） */
const EMOTION_OPTIONS = ['neutral', 'happy', 'thinking', 'surprised', 'sad', 'embarrassed', 'troubled', 'angry'] as const

/** モーションタグの選択肢 */
const MOTION_TAG_OPTIONS = ['idle', 'bow', 'smile', 'think', 'nod', 'wave', 'happy', 'sad', 'nervous', 'confused'] as const

/**
 * モデル管理ページ
 *
 * Live2D モデルの登録・マッピング設定・有効/無効切替・削除を行う。
 */
export function ModelManagement() {
  const token = useAuthStore((s) => s.idToken)
  const [models, setModels] = useState<ModelMeta[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  // アップロード状態
  const [isUploading, setIsUploading] = useState(false)
  const [uploadName, setUploadName] = useState('')
  const [uploadDesc, setUploadDesc] = useState('')
  const [uploadProgress, setUploadProgress] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 編集モーダル
  const [editingModel, setEditingModel] = useState<ModelMeta | null>(null)
  const [editEmotionMapping, setEditEmotionMapping] = useState<Record<string, string>>({})
  const [editMotionMapping, setEditMotionMapping] = useState<Record<string, { group: string; index: number }>>({})
  const [isSaving, setIsSaving] = useState(false)

  /** モデル一覧を読み込み */
  const loadModels = useCallback(async () => {
    if (!token) return
    setIsLoading(true)
    try {
      const result = await adminApi.listModels(token)
      setModels(result.models)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'モデル一覧の取得に失敗しました')
    } finally {
      setIsLoading(false)
    }
  }, [token])

  useEffect(() => {
    loadModels()
  }, [loadModels])

  /**
   * ZIP ファイルを読み込んでアップロード
   */
  const handleUpload = useCallback(async (file: File) => {
    if (!token || !uploadName.trim()) return

    setIsUploading(true)
    setUploadProgress('ZIP ファイルを展開中...')
    setError('')

    try {
      // JSZip で ZIP 展開
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(file)

      // ファイルマップを構築（相対パス → base64）
      const files: Record<string, string> = {}
      const entries = Object.entries(zip.files)

      // ZIP内のルートディレクトリを検出（トップレベルにフォルダがある場合はスキップ）
      let rootPrefix = ''
      const model3Entry = entries.find(([name]) => name.endsWith('.model3.json'))
      if (model3Entry) {
        const parts = model3Entry[0].split('/')
        if (parts.length > 1) {
          rootPrefix = parts.slice(0, -1).join('/') + '/'
        }
      }

      setUploadProgress(`ファイルを読み込み中... (${entries.length} ファイル)`)

      for (const [name, entry] of entries) {
        if (entry.dir) continue

        // ルートプレフィックスを除去
        const relativePath = rootPrefix ? name.replace(rootPrefix, '') : name
        if (!relativePath) continue

        const data = await entry.async('base64')
        files[relativePath] = data
      }

      setUploadProgress('サーバーにアップロード中...')

      await adminApi.uploadModel(token, {
        name: uploadName.trim(),
        description: uploadDesc.trim(),
        files,
      })

      setUploadName('')
      setUploadDesc('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      setUploadProgress('')
      await loadModels()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'アップロードに失敗しました')
      setUploadProgress('')
    } finally {
      setIsUploading(false)
    }
  }, [token, uploadName, uploadDesc, loadModels])

  /** ステータス切替 */
  const handleToggleStatus = useCallback(async (model: ModelMeta) => {
    if (!token) return
    const newStatus = model.status === 'active' ? 'inactive' : 'active'
    try {
      await adminApi.updateModel(token, model.modelId, { status: newStatus })
      await loadModels()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ステータスの更新に失敗しました')
    }
  }, [token, loadModels])

  /** 削除 */
  const handleDelete = useCallback(async (model: ModelMeta) => {
    if (!token) return
    if (!window.confirm(`"${model.name}" を削除しますか？\nS3 上のファイルも削除されます。`)) return
    try {
      await adminApi.deleteModel(token, model.modelId)
      await loadModels()
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました')
    }
  }, [token, loadModels])

  /** マッピング編集を開始 */
  const openMappingEditor = useCallback((model: ModelMeta) => {
    setEditingModel(model)
    setEditEmotionMapping({ ...model.emotionMapping })
    setEditMotionMapping({ ...model.motionMapping })
  }, [])

  /** マッピングを保存 */
  const handleSaveMapping = useCallback(async () => {
    if (!token || !editingModel) return
    setIsSaving(true)
    try {
      await adminApi.updateModel(token, editingModel.modelId, {
        emotionMapping: editEmotionMapping,
        motionMapping: editMotionMapping,
      })
      setEditingModel(null)
      await loadModels()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'マッピングの保存に失敗しました')
    } finally {
      setIsSaving(false)
    }
  }, [token, editingModel, editEmotionMapping, editMotionMapping, loadModels])

  return (
    <div className="p-6 max-w-5xl">
      <h2 className="text-xl font-bold mb-6">モデル管理</h2>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded text-sm">
          {error}
          <button onClick={() => setError('')} className="ml-2 text-red-500 hover:text-red-700">×</button>
        </div>
      )}

      {/* アップロードフォーム */}
      <div className="mb-8 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <h3 className="text-sm font-medium mb-3">新規モデル登録</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <input
            type="text"
            placeholder="モデル名（必須）"
            value={uploadName}
            onChange={(e) => setUploadName(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded text-sm"
            disabled={isUploading}
          />
          <input
            type="text"
            placeholder="説明（任意）"
            value={uploadDesc}
            onChange={(e) => setUploadDesc(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded text-sm"
            disabled={isUploading}
          />
        </div>
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleUpload(file)
            }}
            className="text-sm"
            disabled={isUploading || !uploadName.trim()}
          />
          {isUploading && (
            <span className="text-sm text-gray-500">{uploadProgress}</span>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Live2D モデルの ZIP ファイルをアップロードしてください（.model3.json + .moc3 + テクスチャ + 表情 + モーション）
        </p>
      </div>

      {/* モデル一覧 */}
      {isLoading ? (
        <div className="text-sm text-gray-500">読み込み中...</div>
      ) : models.length === 0 ? (
        <div className="text-sm text-gray-500">登録されたモデルはありません。</div>
      ) : (
        <div className="space-y-4">
          {models.map((model) => (
            <div key={model.modelId} className="p-4 bg-white border border-gray-200 rounded-lg">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium">{model.name}</h4>
                    <span className={`px-2 py-0.5 text-xs rounded ${
                      model.status === 'active'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {model.status === 'active' ? '有効' : '無効'}
                    </span>
                  </div>
                  {model.description && (
                    <p className="text-sm text-gray-500 mt-1">{model.description}</p>
                  )}
                  <div className="text-xs text-gray-400 mt-1">
                    ID: {model.modelId.slice(0, 8)}... |
                    表情: {model.expressions.length}個 |
                    モーション: {model.motions.length}個 |
                    登録: {new Date(model.createdAt).toLocaleDateString('ja-JP')}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openMappingEditor(model)}
                    className="px-3 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                  >
                    マッピング設定
                  </button>
                  <button
                    onClick={() => handleToggleStatus(model)}
                    className="px-3 py-1 text-xs bg-gray-50 text-gray-700 rounded hover:bg-gray-100"
                  >
                    {model.status === 'active' ? '無効化' : '有効化'}
                  </button>
                  <button
                    onClick={() => handleDelete(model)}
                    className="px-3 py-1 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100"
                  >
                    削除
                  </button>
                </div>
              </div>

              {/* 現在のマッピング表示 */}
              <div className="mt-3 grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-gray-500 font-medium">感情マッピング:</span>
                  <div className="mt-1 space-y-0.5">
                    {Object.entries(model.emotionMapping).map(([emotion, expression]) => (
                      <div key={emotion} className="flex gap-2">
                        <span className="text-gray-400 w-24">{emotion}</span>
                        <span className="text-gray-700">→ {expression}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="text-gray-500 font-medium">モーションマッピング:</span>
                  <div className="mt-1 space-y-0.5">
                    {Object.entries(model.motionMapping).map(([tag, def]) => (
                      <div key={tag} className="flex gap-2">
                        <span className="text-gray-400 w-24">{tag}</span>
                        <span className="text-gray-700">→ {def.group}[{def.index}]</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* マッピング編集モーダル */}
      {editingModel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={(e) => { if (e.target === e.currentTarget) setEditingModel(null) }}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-medium">マッピング設定 — {editingModel.name}</h3>
              <button onClick={() => setEditingModel(null)} className="text-gray-400 hover:text-gray-600">×</button>
            </div>

            <div className="p-4 overflow-y-auto max-h-[70vh] space-y-6">
              {/* 感情→表情マッピング */}
              <div>
                <h4 className="text-sm font-medium mb-2">感情 → 表情</h4>
                <p className="text-xs text-gray-400 mb-3">LLM の emotion フィールド値を、モデルの表情ファイルに紐付けます。</p>
                <div className="space-y-2">
                  {EMOTION_OPTIONS.map((emotion) => (
                    <div key={emotion} className="flex items-center gap-3">
                      <span className="text-sm text-gray-600 w-28">{emotion}</span>
                      <span className="text-gray-400">→</span>
                      <select
                        value={editEmotionMapping[emotion] ?? ''}
                        onChange={(e) => {
                          const newMap = { ...editEmotionMapping }
                          if (e.target.value) {
                            newMap[emotion] = e.target.value
                          } else {
                            delete newMap[emotion]
                          }
                          setEditEmotionMapping(newMap)
                        }}
                        className="px-2 py-1 border border-gray-300 rounded text-sm flex-1"
                      >
                        <option value="">（未設定）</option>
                        {editingModel.expressions.map((exp) => (
                          <option key={exp.name} value={exp.name}>{exp.name} ({exp.file})</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* モーションタグ→モーションマッピング */}
              <div>
                <h4 className="text-sm font-medium mb-2">モーションタグ → モーション</h4>
                <p className="text-xs text-gray-400 mb-3">アプリ内のモーションタグを、モデルのモーショングループ+インデックスに紐付けます。</p>
                <div className="space-y-2">
                  {MOTION_TAG_OPTIONS.map((tag) => (
                    <div key={tag} className="flex items-center gap-3">
                      <span className="text-sm text-gray-600 w-28">{tag}</span>
                      <span className="text-gray-400">→</span>
                      <select
                        value={editMotionMapping[tag] ? `${editMotionMapping[tag].group}|${editMotionMapping[tag].index}` : ''}
                        onChange={(e) => {
                          const newMap = { ...editMotionMapping }
                          if (e.target.value) {
                            const parts = e.target.value.split('|')
                            newMap[tag] = { group: parts[0] ?? '', index: parseInt(parts[1] ?? '0', 10) }
                          } else {
                            delete newMap[tag]
                          }
                          setEditMotionMapping(newMap)
                        }}
                        className="px-2 py-1 border border-gray-300 rounded text-sm flex-1"
                      >
                        <option value="">（未設定）</option>
                        {editingModel.motions.map((m) => (
                          <option key={`${m.group}|${m.index}`} value={`${m.group}|${m.index}`}>
                            {m.group || '(default)'}[{m.index}] — {m.file}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 p-4 border-t">
              <button
                onClick={() => setEditingModel(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleSaveMapping}
                disabled={isSaving}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {isSaving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
