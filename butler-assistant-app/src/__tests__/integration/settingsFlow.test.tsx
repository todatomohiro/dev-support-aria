import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { Settings } from '@/components'
import { platformAdapter } from '@/platform'
import { useAppStore } from '@/stores'

// platformAdapterをモック
vi.mock('@/platform', () => ({
  platformAdapter: {
    loadSecureData: vi.fn(),
    saveSecureData: vi.fn(),
    deleteSecureData: vi.fn(),
  },
  currentPlatform: 'web',
  logPlatformInfo: vi.fn(),
}))

describe('設定フロー統合テスト', () => {
  const mockConfig = {
    llm: {
      provider: 'gemini' as const,
      apiKey: '',
      systemPrompt: '',
      temperature: 0.7,
      maxTokens: 1024,
    },
    ui: {
      theme: 'light' as const,
      fontSize: 14,
      characterSize: 100,
    },
  }

  const mockOnClose = vi.fn()
  const mockOnSave = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(platformAdapter.loadSecureData).mockResolvedValue(null)
    vi.mocked(platformAdapter.saveSecureData).mockResolvedValue(undefined)
    vi.mocked(platformAdapter.deleteSecureData).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('APIキー設定フロー', () => {
    it('APIキーを入力して保存できる', async () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      // Gemini APIキーを入力
      const geminiInput = screen.getByTestId('gemini-api-key-input')
      fireEvent.change(geminiInput, { target: { value: 'AIzaSyTestKey123' } })

      // 保存ボタンをクリック
      const saveButton = screen.getByTestId('save-button')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      // セキュアストレージに保存されたことを確認
      await waitFor(() => {
        expect(platformAdapter.saveSecureData).toHaveBeenCalledWith(
          'gemini-api-key',
          'AIzaSyTestKey123'
        )
      })

      // onSaveが呼ばれたことを確認
      expect(mockOnSave).toHaveBeenCalled()
      expect(mockOnClose).toHaveBeenCalled()
    })

    it('既存のAPIキーが読み込まれる', async () => {
      vi.mocked(platformAdapter.loadSecureData).mockImplementation(async (key) => {
        if (key === 'gemini-api-key') return 'existing-gemini-key'
        if (key === 'claude-api-key') return 'existing-claude-key'
        return null
      })

      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      // APIキーが読み込まれるのを待つ
      await waitFor(() => {
        expect(screen.getByTestId('gemini-api-key-input')).toHaveValue('existing-gemini-key')
      })
    })

    it('プロバイダーを切り替えると対応するAPIキーが使用される', async () => {
      vi.mocked(platformAdapter.loadSecureData).mockImplementation(async (key) => {
        if (key === 'gemini-api-key') return 'gemini-key'
        if (key === 'claude-api-key') return 'claude-key'
        return null
      })

      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      // キーが読み込まれるのを待つ
      await waitFor(() => {
        expect(screen.getByTestId('gemini-api-key-input')).toHaveValue('gemini-key')
      })

      // Claudeに切り替え
      fireEvent.click(screen.getByTestId('provider-claude'))

      // 保存
      await act(async () => {
        fireEvent.click(screen.getByTestId('save-button'))
      })

      // onSaveがClaudeのAPIキーで呼ばれることを確認
      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            llm: expect.objectContaining({
              provider: 'claude',
              apiKey: 'claude-key',
            }),
          })
        )
      })
    })
  })

  describe('LLM設定フロー', () => {
    it('システムプロンプトを設定できる', async () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      // LLM設定タブに移動
      fireEvent.click(screen.getByTestId('tab-llm設定'))

      // システムプロンプトを入力
      const promptInput = screen.getByTestId('system-prompt-input')
      fireEvent.change(promptInput, { target: { value: 'あなたは丁寧な執事です。' } })

      // 保存
      await act(async () => {
        fireEvent.click(screen.getByTestId('save-button'))
      })

      // onSaveが呼ばれたことを確認
      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            llm: expect.objectContaining({
              systemPrompt: 'あなたは丁寧な執事です。',
            }),
          })
        )
      })
    })

    it('Temperatureを調整できる', async () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      // LLM設定タブに移動
      fireEvent.click(screen.getByTestId('tab-llm設定'))

      // Temperatureを変更
      const slider = screen.getByTestId('temperature-slider')
      fireEvent.change(slider, { target: { value: '1.5' } })

      // 保存
      await act(async () => {
        fireEvent.click(screen.getByTestId('save-button'))
      })

      // onSaveが呼ばれたことを確認
      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            llm: expect.objectContaining({
              temperature: 1.5,
            }),
          })
        )
      })
    })
  })

  describe('UI設定フロー', () => {
    it('テーマを切り替えられる', async () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      // 表示設定タブに移動
      fireEvent.click(screen.getByTestId('tab-表示設定'))

      // ダークモードに切り替え
      fireEvent.click(screen.getByTestId('theme-dark'))

      // 保存
      await act(async () => {
        fireEvent.click(screen.getByTestId('save-button'))
      })

      // onSaveが呼ばれたことを確認
      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            ui: expect.objectContaining({
              theme: 'dark',
            }),
          })
        )
      })
    })

    it('フォントサイズを変更できる', async () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      // 表示設定タブに移動
      fireEvent.click(screen.getByTestId('tab-表示設定'))

      // フォントサイズを変更
      const slider = screen.getByTestId('font-size-slider')
      fireEvent.change(slider, { target: { value: '20' } })

      // 保存
      await act(async () => {
        fireEvent.click(screen.getByTestId('save-button'))
      })

      // onSaveが呼ばれたことを確認
      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            ui: expect.objectContaining({
              fontSize: 20,
            }),
          })
        )
      })
    })
  })

  describe('キャンセルフロー', () => {
    it('キャンセル時に変更が保存されない', async () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      // Gemini APIキーを入力
      const geminiInput = screen.getByTestId('gemini-api-key-input')
      fireEvent.change(geminiInput, { target: { value: 'test-key' } })

      // キャンセルボタンをクリック
      fireEvent.click(screen.getByTestId('cancel-button'))

      // 保存されていないことを確認
      expect(platformAdapter.saveSecureData).not.toHaveBeenCalled()
      expect(mockOnSave).not.toHaveBeenCalled()
      expect(mockOnClose).toHaveBeenCalled()
    })
  })
})

describe('設定とストアの連携', () => {
  beforeEach(() => {
    const store = useAppStore.getState()
    store.updateConfig({
      llm: {
        provider: 'gemini',
        apiKey: '',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 1024,
      },
      ui: {
        theme: 'light',
        fontSize: 14,
        characterSize: 100,
      },
    })
  })

  it('設定の更新がストアに反映される', () => {
    const store = useAppStore.getState()

    store.updateConfig({
      llm: {
        provider: 'claude',
        apiKey: 'test-key',
        temperature: 1.0,
      },
      ui: {
        theme: 'dark',
      },
    })

    const state = useAppStore.getState()
    expect(state.config.llm.provider).toBe('claude')
    expect(state.config.llm.apiKey).toBe('test-key')
    expect(state.config.llm.temperature).toBe(1.0)
    expect(state.config.ui.theme).toBe('dark')
    // 変更されていない値は維持される
    expect(state.config.llm.maxTokens).toBe(1024)
    expect(state.config.ui.fontSize).toBe(14)
  })
})
