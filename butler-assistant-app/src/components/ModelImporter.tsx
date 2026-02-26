import { useState, useRef, useCallback, useEffect, type DragEvent, type ChangeEvent } from 'react'
import { modelLoader } from '@/services'
import type { ModelConfig, ModelLoadError as ModelLoadErrorType } from '@/types'

interface ModelImporterProps {
  onImportComplete: (config: ModelConfig) => void
  onError?: (error: ModelLoadErrorType) => void
  className?: string
}

type ImportState = 'idle' | 'validating' | 'importing' | 'complete' | 'error'

interface ImportProgress {
  state: ImportState
  message: string
  progress: number
}

/**
 * Model Importer コンポーネント
 * Live2Dモデルのインポート機能を提供
 */
export function ModelImporter({
  onImportComplete,
  onError,
  className = '',
}: ModelImporterProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [importProgress, setImportProgress] = useState<ImportProgress>({
    state: 'idle',
    message: '',
    progress: 0,
  })
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /**
   * ファイル選択ダイアログを開く
   */
  const handleSelectClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  /**
   * ファイル選択時の処理
   */
  const handleFileSelect = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files
      if (!files || files.length === 0) return

      await processFiles(Array.from(files))

      // 入力をリセット
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    []
  )

  /**
   * ドラッグオーバー時の処理
   */
  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(true)
  }, [])

  /**
   * ドラッグ離脱時の処理
   */
  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)
  }, [])

  /**
   * ドロップ時の処理
   */
  const handleDrop = useCallback(async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)

    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return

    await processFiles(files)
  }, [])

  /**
   * ファイル処理の共通ロジック
   */
  const processFiles = async (files: File[]) => {
    setErrorMessage(null)

    // .model3.json ファイルを探す
    const modelFile = files.find((file) => file.name.endsWith('.model3.json'))
    if (!modelFile) {
      setErrorMessage('model3.jsonファイルが見つかりません。Live2Dモデルフォルダを選択してください。')
      return
    }

    try {
      // バリデーション開始
      setImportProgress({
        state: 'validating',
        message: 'モデルファイルを検証中...',
        progress: 25,
      })

      // バリデーション
      const validation = modelLoader.validateModelFiles(files)
      if (!validation.isValid) {
        const errorMsg = validation.errors.map(e => `${e.field}: ${e.message}`).join('\n')
        setErrorMessage(errorMsg)
        setImportProgress({
          state: 'error',
          message: 'バリデーションエラー',
          progress: 0,
        })
        return
      }

      // インポート開始
      setImportProgress({
        state: 'importing',
        message: 'モデルをインポート中...',
        progress: 50,
      })

      // モデル読み込み
      const config = await modelLoader.loadModel(files)

      // 保存
      setImportProgress({
        state: 'importing',
        message: 'モデルを保存中...',
        progress: 75,
      })

      await modelLoader.saveModel(config)

      // 完了
      setImportProgress({
        state: 'complete',
        message: 'インポート完了',
        progress: 100,
      })

      onImportComplete(config)

      // 状態をリセット（少し待ってから）
      setTimeout(() => {
        setImportProgress({
          state: 'idle',
          message: '',
          progress: 0,
        })
      }, 2000)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'インポートに失敗しました'
      setErrorMessage(errorMsg)
      setImportProgress({
        state: 'error',
        message: 'インポートエラー',
        progress: 0,
      })

      if (onError && error instanceof Error) {
        onError(error as ModelLoadErrorType)
      }
    }
  }

  /**
   * エラーをクリア
   */
  const handleClearError = useCallback(() => {
    setErrorMessage(null)
    setImportProgress({
      state: 'idle',
      message: '',
      progress: 0,
    })
  }, [])

  const isProcessing = importProgress.state === 'validating' || importProgress.state === 'importing'

  return (
    <div className={`model-importer ${className}`} data-testid="model-importer">
      {/* ドロップゾーン */}
      <div
        className={`
          drop-zone
          border-2 border-dashed rounded-lg p-8
          flex flex-col items-center justify-center
          min-h-[200px]
          transition-colors duration-200
          ${isDragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50'}
          ${isProcessing ? 'opacity-50 pointer-events-none' : 'cursor-pointer hover:border-blue-400'}
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={isProcessing ? undefined : handleSelectClick}
        data-testid="drop-zone"
      >
        {importProgress.state === 'idle' && (
          <>
            <svg
              className="w-12 h-12 text-gray-400 mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p className="text-gray-600 text-center mb-2">
              Live2Dモデルをドラッグ&ドロップ
            </p>
            <p className="text-gray-400 text-sm text-center">
              または クリックしてファイルを選択
            </p>
          </>
        )}

        {(importProgress.state === 'validating' || importProgress.state === 'importing') && (
          <div className="text-center" data-testid="import-progress">
            <div className="w-48 h-2 bg-gray-200 rounded-full mb-4">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${importProgress.progress}%` }}
                data-testid="progress-bar"
              />
            </div>
            <p className="text-gray-600">{importProgress.message}</p>
          </div>
        )}

        {importProgress.state === 'complete' && (
          <div className="text-center text-green-600" data-testid="import-complete">
            <svg
              className="w-12 h-12 mx-auto mb-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            <p>{importProgress.message}</p>
          </div>
        )}
      </div>

      {/* 隠しファイル入力 */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".model3.json,.moc3,.png,.jpg,.jpeg,.json"
        onChange={handleFileSelect}
        className="hidden"
        data-testid="file-input"
      />

      {/* エラー表示 */}
      {errorMessage && (
        <div
          className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg"
          data-testid="error-message"
        >
          <div className="flex items-start">
            <svg
              className="w-5 h-5 text-red-500 mr-2 flex-shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div className="flex-1">
              <p className="text-red-700 text-sm whitespace-pre-wrap">{errorMessage}</p>
            </div>
            <button
              onClick={handleClearError}
              className="text-red-500 hover:text-red-700 ml-2"
              data-testid="clear-error-button"
            >
              <svg
                className="w-5 h-5"
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
        </div>
      )}

      {/* 保存済みモデル一覧 */}
      <ModelList onSelect={onImportComplete} />
    </div>
  )
}

/**
 * 保存済みモデル一覧コンポーネント
 */
interface ModelListProps {
  onSelect: (config: ModelConfig) => void
}

function ModelList({ onSelect }: ModelListProps) {
  const [models, setModels] = useState<ModelConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // モデル一覧を取得
  useEffect(() => {
    let isMounted = true
    const loadModels = async () => {
      try {
        const list = await modelLoader.listModels()
        if (isMounted) {
          setModels(list)
        }
      } catch {
        // エラーは無視
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }
    loadModels()
    return () => {
      isMounted = false
    }
  }, [])

  if (isLoading) {
    return (
      <div className="mt-6" data-testid="model-list-loading">
        <p className="text-gray-500 text-sm">読み込み中...</p>
      </div>
    )
  }

  if (models.length === 0) {
    return null
  }

  return (
    <div className="mt-6" data-testid="model-list">
      <h3 className="text-sm font-medium text-gray-700 mb-3">保存済みモデル</h3>
      <div className="space-y-2">
        {models.map((model) => (
          <button
            key={model.id}
            onClick={() => onSelect(model)}
            className="w-full text-left p-3 bg-white border border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-colors"
            data-testid="model-item"
          >
            <p className="font-medium text-gray-800">{model.name}</p>
            <p className="text-sm text-gray-500">{model.modelPath}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
