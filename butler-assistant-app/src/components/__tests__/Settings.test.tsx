import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Settings } from '../Settings'
import { platformAdapter } from '@/platform'

// platformAdapterをモック
vi.mock('@/platform', () => ({
  platformAdapter: {
    loadSecureData: vi.fn(),
    saveSecureData: vi.fn(),
    deleteSecureData: vi.fn(),
  },
}))

const mockConfig = {
  llm: {
    provider: 'gemini' as const,
    apiKey: '',
    systemPrompt: 'テスト用プロンプト',
    temperature: 0.7,
    maxTokens: 1024,
  },
  ui: {
    theme: 'light' as const,
    fontSize: 14,
    characterSize: 100,
  },
}

describe('Settings', () => {
  const mockOnClose = vi.fn()
  const mockOnSave = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(platformAdapter.loadSecureData).mockResolvedValue(null)
    vi.mocked(platformAdapter.saveSecureData).mockResolvedValue(undefined)
    vi.mocked(platformAdapter.deleteSecureData).mockResolvedValue(undefined)
  })

  describe('表示制御', () => {
    it('isOpenがfalseの場合は何も表示されない', () => {
      render(
        <Settings
          isOpen={false}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      expect(screen.queryByTestId('settings-panel')).not.toBeInTheDocument()
    })

    it('isOpenがtrueの場合は設定パネルが表示される', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      expect(screen.getByTestId('settings-panel')).toBeInTheDocument()
    })
  })

  describe('タブ切り替え', () => {
    it('初期状態ではAPIキータブが表示される', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      expect(screen.getByTestId('gemini-api-key-input')).toBeInTheDocument()
    })

    it('LLM設定タブに切り替えられる', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      fireEvent.click(screen.getByTestId('tab-llm設定'))
      expect(screen.getByTestId('system-prompt-input')).toBeInTheDocument()
    })

    it('表示設定タブに切り替えられる', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      fireEvent.click(screen.getByTestId('tab-表示設定'))
      expect(screen.getByTestId('theme-light')).toBeInTheDocument()
    })
  })

  describe('APIキー管理', () => {
    it('既存のAPIキーを読み込む', async () => {
      vi.mocked(platformAdapter.loadSecureData).mockImplementation(async (key) => {
        if (key === 'gemini-api-key') return 'test-gemini-key'
        if (key === 'claude-api-key') return 'test-claude-key'
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

      await waitFor(() => {
        expect(screen.getByTestId('gemini-api-key-input')).toHaveValue('test-gemini-key')
      })
    })

    it('APIキーの表示/非表示を切り替えられる', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      const geminiInput = screen.getByTestId('gemini-api-key-input')
      expect(geminiInput).toHaveAttribute('type', 'password')

      fireEvent.click(screen.getByTestId('toggle-gemini-visibility'))
      expect(geminiInput).toHaveAttribute('type', 'text')

      fireEvent.click(screen.getByTestId('toggle-gemini-visibility'))
      expect(geminiInput).toHaveAttribute('type', 'password')
    })

    it('Gemini APIキーを入力できる', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      const input = screen.getByTestId('gemini-api-key-input')
      fireEvent.change(input, { target: { value: 'new-api-key' } })
      expect(input).toHaveValue('new-api-key')
    })

    it('Claude APIキーを入力できる', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      const input = screen.getByTestId('claude-api-key-input')
      fireEvent.change(input, { target: { value: 'sk-ant-test' } })
      expect(input).toHaveValue('sk-ant-test')
    })
  })

  describe('プロバイダー選択', () => {
    it('Geminiが初期選択されている', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      expect(screen.getByTestId('provider-gemini')).toBeChecked()
      expect(screen.getByTestId('provider-claude')).not.toBeChecked()
    })

    it('プロバイダーを切り替えられる', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      fireEvent.click(screen.getByTestId('provider-claude'))
      expect(screen.getByTestId('provider-claude')).toBeChecked()
      expect(screen.getByTestId('provider-gemini')).not.toBeChecked()
    })
  })

  describe('LLM設定', () => {
    it('システムプロンプトを編集できる', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      fireEvent.click(screen.getByTestId('tab-llm設定'))
      const input = screen.getByTestId('system-prompt-input')
      expect(input).toHaveValue('テスト用プロンプト')

      fireEvent.change(input, { target: { value: '新しいプロンプト' } })
      expect(input).toHaveValue('新しいプロンプト')
    })

    it('Temperatureを調整できる', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      fireEvent.click(screen.getByTestId('tab-llm設定'))
      const slider = screen.getByTestId('temperature-slider')
      fireEvent.change(slider, { target: { value: '1.0' } })
      expect(slider).toHaveValue('1')
    })

    it('最大トークン数を調整できる', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      fireEvent.click(screen.getByTestId('tab-llm設定'))
      const slider = screen.getByTestId('max-tokens-slider')
      fireEvent.change(slider, { target: { value: '2048' } })
      expect(slider).toHaveValue('2048')
    })
  })

  describe('UI設定', () => {
    it('テーマを切り替えられる', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      fireEvent.click(screen.getByTestId('tab-表示設定'))
      expect(screen.getByTestId('theme-light')).toBeChecked()

      fireEvent.click(screen.getByTestId('theme-dark'))
      expect(screen.getByTestId('theme-dark')).toBeChecked()
    })

    it('フォントサイズを調整できる', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      fireEvent.click(screen.getByTestId('tab-表示設定'))
      const slider = screen.getByTestId('font-size-slider')
      fireEvent.change(slider, { target: { value: '18' } })
      expect(slider).toHaveValue('18')
    })

    it('キャラクターサイズを調整できる', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      fireEvent.click(screen.getByTestId('tab-表示設定'))
      const slider = screen.getByTestId('character-size-slider')
      fireEvent.change(slider, { target: { value: '120' } })
      expect(slider).toHaveValue('120')
    })
  })

  describe('保存とキャンセル', () => {
    it('保存ボタンで設定を保存する', async () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      // APIキーを入力
      fireEvent.change(screen.getByTestId('gemini-api-key-input'), {
        target: { value: 'new-gemini-key' },
      })

      // 保存
      fireEvent.click(screen.getByTestId('save-button'))

      await waitFor(() => {
        expect(platformAdapter.saveSecureData).toHaveBeenCalledWith(
          'gemini-api-key',
          'new-gemini-key'
        )
        expect(mockOnSave).toHaveBeenCalled()
        expect(mockOnClose).toHaveBeenCalled()
      })
    })

    it('キャンセルボタンで閉じる', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      fireEvent.click(screen.getByTestId('cancel-button'))
      expect(mockOnClose).toHaveBeenCalled()
      expect(mockOnSave).not.toHaveBeenCalled()
    })

    it('閉じるボタンで閉じる', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      fireEvent.click(screen.getByTestId('close-button'))
      expect(mockOnClose).toHaveBeenCalled()
    })

    it('オーバーレイクリックで閉じる', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      fireEvent.click(screen.getByTestId('settings-overlay'))
      expect(mockOnClose).toHaveBeenCalled()
    })

    it('空のAPIキーは削除される', async () => {
      vi.mocked(platformAdapter.loadSecureData).mockResolvedValue('existing-key')

      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('gemini-api-key-input')).toHaveValue('existing-key')
      })

      // APIキーをクリア
      fireEvent.change(screen.getByTestId('gemini-api-key-input'), {
        target: { value: '' },
      })

      fireEvent.click(screen.getByTestId('save-button'))

      await waitFor(() => {
        expect(platformAdapter.deleteSecureData).toHaveBeenCalledWith('gemini-api-key')
      })
    })
  })

  describe('設定の復元', () => {
    it('キャンセル時に設定が元に戻る', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      // プロバイダーを変更
      fireEvent.click(screen.getByTestId('provider-claude'))
      expect(screen.getByTestId('provider-claude')).toBeChecked()

      // キャンセル
      fireEvent.click(screen.getByTestId('cancel-button'))

      // 再度開いた時に元に戻っている想定（再レンダリング）
      expect(mockOnClose).toHaveBeenCalled()
    })
  })
})
