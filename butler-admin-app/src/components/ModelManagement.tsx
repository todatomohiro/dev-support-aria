import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router'
import { adminApi } from '@/services/adminApi'
import { useAuthStore } from '@/auth/authStore'
import type { ModelMeta } from '@/types/admin'

/**
 * モデル管理ページ（一覧）
 *
 * Live2D モデルの登録・有効/無効切替・削除を行う。
 * マッピング設定は専用ページに遷移。
 */
export function ModelManagement() {
  const token = useAuthStore((s) => s.idToken)
  const navigate = useNavigate()
  const [models, setModels] = useState<ModelMeta[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  // アップロード状態
  const [isUploading, setIsUploading] = useState(false)
  const [uploadName, setUploadName] = useState('')
  const [uploadDesc, setUploadDesc] = useState('')
  const [uploadProgress, setUploadProgress] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  /** ZIP ファイルを読み込んでアップロード（Presigned URL 方式） */
  const handleUpload = useCallback(async (file: File) => {
    if (!token || !uploadName.trim()) return

    setIsUploading(true)
    setUploadProgress('ZIP ファイルを展開中...')
    setError('')

    try {
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(file)
      const entries = Object.entries(zip.files)

      let rootPrefix = ''
      const model3Entry = entries.find(([name]) => name.endsWith('.model3.json'))
      if (model3Entry) {
        const parts = model3Entry[0].split('/')
        if (parts.length > 1) {
          rootPrefix = parts.slice(0, -1).join('/') + '/'
        }
      }

      const fileEntries: Array<{ relativePath: string; zipName: string }> = []
      for (const [name, entry] of entries) {
        if (entry.dir) continue
        const relativePath = rootPrefix ? name.replace(rootPrefix, '') : name
        if (!relativePath) continue
        fileEntries.push({ relativePath, zipName: name })
      }

      const model3Path = fileEntries.find((e) => e.relativePath.endsWith('.model3.json'))?.relativePath
      if (!model3Path) throw new Error('.model3.json が見つかりません')

      setUploadProgress('アップロードURLを取得中...')
      const { modelId, uploadUrls } = await adminApi.prepareUpload(token, {
        name: uploadName.trim(),
        filePaths: fileEntries.map((e) => e.relativePath),
      })

      const total = fileEntries.length
      let uploaded = 0
      for (const { relativePath, zipName } of fileEntries) {
        const url = uploadUrls[relativePath]
        if (!url) continue
        const zipEntry = zip.files[zipName]
        if (!zipEntry) continue
        const data = await zipEntry.async('arraybuffer')
        await fetch(url, { method: 'PUT', body: data })
        uploaded++
        setUploadProgress(`アップロード中... (${uploaded}/${total})`)
      }

      setUploadProgress('メタデータを登録中...')
      await adminApi.finalizeUpload(token, modelId, {
        name: uploadName.trim(),
        description: uploadDesc.trim(),
        model3Path,
      })

      setUploadName('')
      setUploadDesc('')
      setSelectedFile(null)
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
            onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            className="text-sm"
            disabled={isUploading}
          />
          <button
            onClick={() => { if (selectedFile) handleUpload(selectedFile) }}
            disabled={isUploading || !uploadName.trim() || !selectedFile}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            アップロード
          </button>
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
        <div className="space-y-3">
          {models.map((model) => (
            <div key={model.modelId} className="p-4 bg-white border border-gray-200 rounded-lg flex items-center justify-between">
              <div className="min-w-0">
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
                  <p className="text-sm text-gray-500 mt-0.5">{model.description}</p>
                )}
                <div className="text-xs text-gray-400 mt-0.5">
                  表情: {model.expressions.length}個 | モーション: {model.motions.length}個 | 登録: {new Date(model.createdAt).toLocaleDateString('ja-JP')}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                <button
                  onClick={() => navigate(`/models/${model.modelId}/character`)}
                  className="px-3 py-1.5 text-xs bg-purple-50 text-purple-700 rounded hover:bg-purple-100"
                >
                  キャラクター設定
                </button>
                <button
                  onClick={() => navigate(`/models/${model.modelId}/mapping`)}
                  className="px-3 py-1.5 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                >
                  マッピング設定
                </button>
                <button
                  onClick={() => handleToggleStatus(model)}
                  className="px-3 py-1.5 text-xs bg-gray-50 text-gray-700 rounded hover:bg-gray-100"
                >
                  {model.status === 'active' ? '無効化' : '有効化'}
                </button>
                <button
                  onClick={() => handleDelete(model)}
                  className="px-3 py-1.5 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100"
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
