import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { ModelImporter } from '../ModelImporter'
import { modelLoader } from '@/services'
import type { ModelConfig } from '@/types'

// モックセットアップ
vi.mock('@/services', () => ({
  modelLoader: {
    loadModel: vi.fn(),
    validateModelFiles: vi.fn(),
    saveModel: vi.fn(),
    listModels: vi.fn(),
  },
}))

const mockModelLoader = vi.mocked(modelLoader)

// テスト用のモデル設定
const createMockModelConfig = (id: string = 'test-model'): ModelConfig => ({
  id,
  name: 'Test Model',
  modelPath: '/path/to/model.model3.json',
  motions: {
    idle: { group: 'Idle', index: 0 },
    happy: { group: 'Happy', index: 0 },
  },
  expressions: {},
  scale: 1.0,
  position: { x: 0, y: 0 },
})

describe('ModelImporter', () => {
  const mockOnImportComplete = vi.fn()
  const mockOnError = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockModelLoader.listModels.mockResolvedValue([])
    mockModelLoader.validateModelFiles.mockReturnValue({ isValid: true, errors: [] })
    mockModelLoader.loadModel.mockResolvedValue(createMockModelConfig())
    mockModelLoader.saveModel.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
  })

  describe('初期表示', () => {
    it('ドロップゾーンが表示される', () => {
      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      expect(screen.getByTestId('drop-zone')).toBeInTheDocument()
      expect(screen.getByText(/Live2Dモデルをドラッグ/)).toBeInTheDocument()
    })

    it('ファイル入力が存在する', () => {
      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      const input = screen.getByTestId('file-input')
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('type', 'file')
    })
  })

  describe('ドラッグ&ドロップ', () => {
    it('ドラッグオーバー時にスタイルが変化する', () => {
      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      const dropZone = screen.getByTestId('drop-zone')

      fireEvent.dragOver(dropZone, {
        dataTransfer: { files: [] },
      })

      expect(dropZone.className).toContain('border-blue-500')
    })

    it('ドラッグ離脱時にスタイルが戻る', () => {
      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      const dropZone = screen.getByTestId('drop-zone')

      fireEvent.dragOver(dropZone, {
        dataTransfer: { files: [] },
      })

      fireEvent.dragLeave(dropZone, {
        dataTransfer: { files: [] },
      })

      expect(dropZone.className).not.toContain('border-blue-500')
    })

    it('model3.jsonファイルなしでエラー表示', async () => {
      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      const dropZone = screen.getByTestId('drop-zone')
      const file = new File(['{}'], 'texture.png', { type: 'image/png' })

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [file],
        },
      })

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument()
        expect(screen.getByText(/model3.jsonファイルが見つかりません/)).toBeInTheDocument()
      })
    })

    it('有効なファイルのドロップで処理が開始される', async () => {
      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      const dropZone = screen.getByTestId('drop-zone')
      const file = new File(['{}'], 'model.model3.json', { type: 'application/json' })

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [file],
        },
      })

      await waitFor(() => {
        expect(mockModelLoader.validateModelFiles).toHaveBeenCalled()
      })
    })
  })

  describe('ファイル選択', () => {
    it('クリックでファイル選択ダイアログが開く', () => {
      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      const dropZone = screen.getByTestId('drop-zone')
      const fileInput = screen.getByTestId('file-input') as HTMLInputElement

      // クリックイベントをスパイ
      const clickSpy = vi.spyOn(fileInput, 'click')

      fireEvent.click(dropZone)

      expect(clickSpy).toHaveBeenCalled()
    })

    it('ファイル選択でインポート処理が開始される', async () => {
      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['{}'], 'model.model3.json', { type: 'application/json' })

      Object.defineProperty(fileInput, 'files', {
        value: [file],
      })

      fireEvent.change(fileInput)

      await waitFor(() => {
        expect(mockModelLoader.validateModelFiles).toHaveBeenCalled()
      })
    })
  })

  describe('バリデーション', () => {
    it('バリデーションエラー時にエラーメッセージが表示される', async () => {
      mockModelLoader.validateModelFiles.mockReturnValue({
        isValid: false,
        errors: [{ field: 'modelFile', message: '必須ファイルが見つかりません: model.moc3' }],
      })

      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['{}'], 'model.model3.json', { type: 'application/json' })

      Object.defineProperty(fileInput, 'files', {
        value: [file],
      })

      fireEvent.change(fileInput)

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument()
        expect(screen.getByText(/必須ファイルが見つかりません/)).toBeInTheDocument()
      })
    })
  })

  describe('インポート成功', () => {
    it('インポート成功時にコールバックが呼ばれる', async () => {
      const mockConfig = createMockModelConfig()
      mockModelLoader.loadModel.mockResolvedValue(mockConfig)

      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['{}'], 'model.model3.json', { type: 'application/json' })

      Object.defineProperty(fileInput, 'files', {
        value: [file],
      })

      fireEvent.change(fileInput)

      await waitFor(() => {
        expect(mockOnImportComplete).toHaveBeenCalledWith(mockConfig)
      })
    })

    it('インポート完了メッセージが表示される', async () => {
      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['{}'], 'model.model3.json', { type: 'application/json' })

      Object.defineProperty(fileInput, 'files', {
        value: [file],
      })

      fireEvent.change(fileInput)

      await waitFor(() => {
        expect(screen.getByTestId('import-complete')).toBeInTheDocument()
        expect(screen.getByText(/インポート完了/)).toBeInTheDocument()
      })
    })
  })

  describe('インポートエラー', () => {
    it('ロードエラー時にエラーメッセージが表示される', async () => {
      mockModelLoader.loadModel.mockRejectedValue(new Error('ファイルの読み込みに失敗しました'))

      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['{}'], 'model.model3.json', { type: 'application/json' })

      Object.defineProperty(fileInput, 'files', {
        value: [file],
      })

      fireEvent.change(fileInput)

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument()
        expect(screen.getByText(/ファイルの読み込みに失敗しました/)).toBeInTheDocument()
      })
    })

    it('エラー時にonErrorコールバックが呼ばれる', async () => {
      const error = new Error('テストエラー')
      mockModelLoader.loadModel.mockRejectedValue(error)

      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['{}'], 'model.model3.json', { type: 'application/json' })

      Object.defineProperty(fileInput, 'files', {
        value: [file],
      })

      fireEvent.change(fileInput)

      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalled()
      })
    })

    it('エラークリアボタンでエラーが消える', async () => {
      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      const dropZone = screen.getByTestId('drop-zone')
      const file = new File(['{}'], 'texture.png', { type: 'image/png' })

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [file],
        },
      })

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument()
      })

      const clearButton = screen.getByTestId('clear-error-button')
      fireEvent.click(clearButton)

      expect(screen.queryByTestId('error-message')).not.toBeInTheDocument()
    })
  })

  describe('保存済みモデル一覧', () => {
    it('保存済みモデルがある場合に一覧が表示される', async () => {
      const models = [createMockModelConfig('model-1'), createMockModelConfig('model-2')]
      mockModelLoader.listModels.mockResolvedValue(models)

      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      await waitFor(() => {
        const modelItems = screen.getAllByTestId('model-item')
        expect(modelItems).toHaveLength(2)
      })
    })

    it('モデル選択でコールバックが呼ばれる', async () => {
      const model = createMockModelConfig('model-1')
      mockModelLoader.listModels.mockResolvedValue([model])

      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      await waitFor(() => {
        const modelItem = screen.getByTestId('model-item')
        fireEvent.click(modelItem)
        expect(mockOnImportComplete).toHaveBeenCalledWith(model)
      })
    })
  })

  describe('プログレス表示', () => {
    it('インポート中にプログレスバーが表示される', async () => {
      // loadModelに遅延を追加してプログレス表示を確認
      mockModelLoader.validateModelFiles.mockReturnValue({ isValid: true, errors: [] })
      mockModelLoader.loadModel.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(createMockModelConfig()), 100))
      )

      render(
        <ModelImporter
          onImportComplete={mockOnImportComplete}
          onError={mockOnError}
        />
      )

      const fileInput = screen.getByTestId('file-input')
      const file = new File(['{}'], 'model.model3.json', { type: 'application/json' })

      Object.defineProperty(fileInput, 'files', {
        value: [file],
      })

      fireEvent.change(fileInput)

      await waitFor(() => {
        expect(screen.getByTestId('import-progress')).toBeInTheDocument()
        expect(screen.getByTestId('progress-bar')).toBeInTheDocument()
      })
    })
  })
})
