import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { ModelImporter } from '@/components'
import { modelLoader } from '@/services'
import { useAppStore } from '@/stores'
import type { ModelConfig } from '@/types'

// modelLoaderをモック
vi.mock('@/services', () => ({
  modelLoader: {
    loadModel: vi.fn(),
    validateModelFiles: vi.fn(),
    saveModel: vi.fn(),
    listModels: vi.fn(),
    deleteModel: vi.fn(),
    getModel: vi.fn(),
  },
}))

const mockModelLoader = vi.mocked(modelLoader)

/**
 * テスト用のモデル設定を作成
 */
const createMockModelConfig = (overrides: Partial<ModelConfig> = {}): ModelConfig => ({
  id: 'test-model-1',
  name: 'Test Model',
  modelPath: '/models/test/test.model3.json',
  motions: {
    idle: { group: 'Idle', index: 0 },
    happy: { group: 'TapBody', index: 0 },
  },
  expressions: {},
  scale: 1.0,
  position: { x: 0, y: 0 },
  ...overrides,
})

/**
 * model3.json + テクスチャを含む有効なファイルセットを作成
 */
const createValidFileSet = () => {
  const modelJson = JSON.stringify({
    Version: 3,
    FileReferences: {
      Moc: 'test.moc3',
      Textures: ['test.png'],
      Motions: {
        Idle: [{ File: 'idle.motion3.json' }],
        TapBody: [{ File: 'tap_body.motion3.json' }],
      },
    },
  })

  return [
    new File([modelJson], 'test.model3.json', { type: 'application/json' }),
    new File(['moc-data'], 'test.moc3', { type: 'application/octet-stream' }),
    new File(['texture-data'], 'test.png', { type: 'image/png' }),
  ]
}

describe('モデルインポートフロー統合テスト', () => {
  const mockOnImportComplete = vi.fn()
  const mockOnError = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockModelLoader.listModels.mockResolvedValue([])
    mockModelLoader.validateModelFiles.mockReturnValue({ isValid: true, errors: [] })
    mockModelLoader.loadModel.mockResolvedValue(createMockModelConfig())
    mockModelLoader.saveModel.mockResolvedValue(undefined)

    // ストアをリセット
    useAppStore.getState().updateConfig({
      model: { currentModelId: '/models/mao_pro_jp/mao_pro.model3.json' },
    })
  })

  afterEach(() => {
    cleanup()
  })

  describe('モデル選択からインポート完了までのフロー', () => {
    it('ファイル選択→バリデーション→ロード→保存→完了の一連のフローが成功する', async () => {
      const mockConfig = createMockModelConfig()
      mockModelLoader.loadModel.mockResolvedValue(mockConfig)

      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      // ファイルを選択
      const fileInput = screen.getByTestId('file-input')
      const files = createValidFileSet()

      Object.defineProperty(fileInput, 'files', { value: files })
      fireEvent.change(fileInput)

      // バリデーションが呼ばれることを確認
      await waitFor(() => {
        expect(mockModelLoader.validateModelFiles).toHaveBeenCalledWith(files)
      })

      // ロードが呼ばれることを確認
      await waitFor(() => {
        expect(mockModelLoader.loadModel).toHaveBeenCalledWith(files)
      })

      // 保存が呼ばれることを確認
      await waitFor(() => {
        expect(mockModelLoader.saveModel).toHaveBeenCalledWith(mockConfig)
      })

      // 完了コールバックが呼ばれることを確認
      await waitFor(() => {
        expect(mockOnImportComplete).toHaveBeenCalledWith(mockConfig)
      })

      // 完了メッセージが表示される
      await waitFor(() => {
        expect(screen.getByTestId('import-complete')).toBeInTheDocument()
      })
    })

    it('ドラッグ&ドロップでもインポートフローが完了する', async () => {
      const mockConfig = createMockModelConfig()
      mockModelLoader.loadModel.mockResolvedValue(mockConfig)

      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      const dropZone = screen.getByTestId('drop-zone')
      const files = createValidFileSet()

      // ドラッグ&ドロップ
      fireEvent.drop(dropZone, {
        dataTransfer: { files },
      })

      // 全フローが完了することを確認
      await waitFor(() => {
        expect(mockModelLoader.validateModelFiles).toHaveBeenCalled()
        expect(mockModelLoader.loadModel).toHaveBeenCalled()
        expect(mockModelLoader.saveModel).toHaveBeenCalled()
        expect(mockOnImportComplete).toHaveBeenCalledWith(mockConfig)
      })
    })

    it('保存済みモデル一覧からの選択でコールバックが呼ばれる', async () => {
      const savedModel = createMockModelConfig({ id: 'saved-1', name: 'Saved Model' })
      mockModelLoader.listModels.mockResolvedValue([savedModel])

      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      // 保存済みモデル一覧が表示されるのを待つ
      await waitFor(() => {
        expect(screen.getByTestId('model-list')).toBeInTheDocument()
      })

      // モデルを選択
      const modelItem = screen.getByTestId('model-item')
      fireEvent.click(modelItem)

      expect(mockOnImportComplete).toHaveBeenCalledWith(savedModel)
    })
  })

  describe('バリデーションエラー時の動作', () => {
    it('model3.jsonなしのファイルセットでエラーが表示される', async () => {
      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      const fileInput = screen.getByTestId('file-input')
      const invalidFiles = [
        new File(['texture-data'], 'test.png', { type: 'image/png' }),
      ]

      Object.defineProperty(fileInput, 'files', { value: invalidFiles })
      fireEvent.change(fileInput)

      // model3.jsonがないエラーが表示される
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument()
        expect(screen.getByText(/model3.jsonファイルが見つかりません/)).toBeInTheDocument()
      })

      // loadModelは呼ばれない
      expect(mockModelLoader.loadModel).not.toHaveBeenCalled()
      expect(mockOnImportComplete).not.toHaveBeenCalled()
    })

    it('テクスチャなしでバリデーションエラーになる', async () => {
      mockModelLoader.validateModelFiles.mockReturnValue({
        isValid: false,
        errors: [{ field: 'textures', message: 'テクスチャファイル（.png または .jpg）が必要です' }],
      })

      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      const fileInput = screen.getByTestId('file-input')
      const files = [
        new File(['{}'], 'model.model3.json', { type: 'application/json' }),
      ]

      Object.defineProperty(fileInput, 'files', { value: files })
      fireEvent.change(fileInput)

      // バリデーションエラーが表示される
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument()
        expect(screen.getByText(/テクスチャファイル/)).toBeInTheDocument()
      })

      // loadModelは呼ばれない
      expect(mockModelLoader.loadModel).not.toHaveBeenCalled()
    })

    it('バリデーションエラー後にエラーをクリアして再試行できる', async () => {
      // 最初はバリデーション失敗
      mockModelLoader.validateModelFiles
        .mockReturnValueOnce({
          isValid: false,
          errors: [{ field: 'textures', message: 'テクスチャファイルが必要です' }],
        })
        // 2回目は成功
        .mockReturnValueOnce({ isValid: true, errors: [] })

      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      // 1回目: 不正なファイル
      const fileInput = screen.getByTestId('file-input')
      const badFiles = [new File(['{}'], 'model.model3.json', { type: 'application/json' })]

      Object.defineProperty(fileInput, 'files', { value: badFiles, writable: true })
      fireEvent.change(fileInput)

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument()
      })

      // エラーをクリア
      const clearButton = screen.getByTestId('clear-error-button')
      fireEvent.click(clearButton)

      expect(screen.queryByTestId('error-message')).not.toBeInTheDocument()

      // 2回目: 有効なファイル
      const goodFiles = createValidFileSet()
      Object.defineProperty(fileInput, 'files', { value: goodFiles })
      fireEvent.change(fileInput)

      await waitFor(() => {
        expect(mockOnImportComplete).toHaveBeenCalled()
      })
    })
  })

  describe('インポート後のモデル切り替え', () => {
    it('インポート完了後にストアのモデルIDが更新される', async () => {
      const newModel = createMockModelConfig({
        id: 'new-model',
        modelPath: '/models/new/new.model3.json',
      })
      mockModelLoader.loadModel.mockResolvedValue(newModel)

      // onImportCompleteでストアを更新するハンドラー
      const handleImportComplete = (config: ModelConfig) => {
        useAppStore.getState().updateConfig({
          model: { currentModelId: config.modelPath },
        })
      }

      render(
        <ModelImporter
          onImportComplete={handleImportComplete}
          onError={mockOnError}
        />
      )

      // インポート前のモデルIDを確認
      expect(useAppStore.getState().config.model.currentModelId).toBe(
        '/models/mao_pro_jp/mao_pro.model3.json'
      )

      // ファイルを選択してインポート
      const fileInput = screen.getByTestId('file-input')
      const files = createValidFileSet()
      Object.defineProperty(fileInput, 'files', { value: files })
      fireEvent.change(fileInput)

      // ストアが更新されることを確認
      await waitFor(() => {
        expect(useAppStore.getState().config.model.currentModelId).toBe(
          '/models/new/new.model3.json'
        )
      })
    })

    it('保存済みモデル選択でもストアのモデルIDが更新される', async () => {
      const savedModel = createMockModelConfig({
        id: 'saved-model',
        name: 'Saved Model',
        modelPath: '/models/saved/saved.model3.json',
      })
      mockModelLoader.listModels.mockResolvedValue([savedModel])

      const handleImportComplete = (config: ModelConfig) => {
        useAppStore.getState().updateConfig({
          model: { currentModelId: config.modelPath },
        })
      }

      render(
        <ModelImporter
          onImportComplete={handleImportComplete}
          onError={mockOnError}
        />
      )

      // 保存済みモデルが表示されるのを待つ
      await waitFor(() => {
        expect(screen.getByTestId('model-item')).toBeInTheDocument()
      })

      // モデルを選択
      fireEvent.click(screen.getByTestId('model-item'))

      // ストアが更新される
      expect(useAppStore.getState().config.model.currentModelId).toBe(
        '/models/saved/saved.model3.json'
      )
    })

    it('複数モデルがある場合に正しいモデルが選択される', async () => {
      const models = [
        createMockModelConfig({ id: 'model-a', name: 'Model A', modelPath: '/models/a.model3.json' }),
        createMockModelConfig({ id: 'model-b', name: 'Model B', modelPath: '/models/b.model3.json' }),
        createMockModelConfig({ id: 'model-c', name: 'Model C', modelPath: '/models/c.model3.json' }),
      ]
      mockModelLoader.listModels.mockResolvedValue(models)

      const handleImportComplete = (config: ModelConfig) => {
        useAppStore.getState().updateConfig({
          model: { currentModelId: config.modelPath },
        })
      }

      render(
        <ModelImporter
          onImportComplete={handleImportComplete}
          onError={mockOnError}
        />
      )

      // モデル一覧が表示されるのを待つ
      await waitFor(() => {
        const items = screen.getAllByTestId('model-item')
        expect(items).toHaveLength(3)
      })

      // 2番目のモデルを選択
      const items = screen.getAllByTestId('model-item')
      fireEvent.click(items[1])

      expect(useAppStore.getState().config.model.currentModelId).toBe('/models/b.model3.json')
    })
  })

  describe('エラーリカバリー', () => {
    it('ロード失敗時にエラーが表示され、onErrorコールバックが呼ばれる', async () => {
      const loadError = new Error('ファイルの読み込みに失敗しました')
      mockModelLoader.loadModel.mockRejectedValue(loadError)

      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      const fileInput = screen.getByTestId('file-input')
      const files = createValidFileSet()
      Object.defineProperty(fileInput, 'files', { value: files })
      fireEvent.change(fileInput)

      // エラーメッセージが表示される
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument()
        expect(screen.getByText(/ファイルの読み込みに失敗しました/)).toBeInTheDocument()
      })

      // onErrorが呼ばれる
      expect(mockOnError).toHaveBeenCalled()

      // onImportCompleteは呼ばれない
      expect(mockOnImportComplete).not.toHaveBeenCalled()
    })

    it('保存失敗時にエラーが表示される', async () => {
      mockModelLoader.saveModel.mockRejectedValue(new Error('ストレージへの保存に失敗しました'))

      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      const fileInput = screen.getByTestId('file-input')
      const files = createValidFileSet()
      Object.defineProperty(fileInput, 'files', { value: files })
      fireEvent.change(fileInput)

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument()
        expect(screen.getByText(/ストレージへの保存に失敗しました/)).toBeInTheDocument()
      })
    })
  })
})
