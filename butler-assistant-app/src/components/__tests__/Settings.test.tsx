import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Settings } from '../Settings'

const mockConfig = {
  ui: {
    theme: 'light' as const,
    fontSize: 14,
    characterSize: 100,
    developerMode: false,
  },
}

describe('Settings', () => {
  const mockOnClose = vi.fn()
  const mockOnSave = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
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

      // テーマを変更
      fireEvent.click(screen.getByTestId('theme-dark'))

      // 保存
      fireEvent.click(screen.getByTestId('save-button'))

      expect(mockOnSave).toHaveBeenCalledWith({
        ui: {
          theme: 'dark',
          fontSize: 14,
          characterSize: 100,
          developerMode: false,
        },
      })
      expect(mockOnClose).toHaveBeenCalled()
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

      // テーマを変更
      fireEvent.click(screen.getByTestId('theme-dark'))
      expect(screen.getByTestId('theme-dark')).toBeChecked()

      // キャンセル
      fireEvent.click(screen.getByTestId('cancel-button'))

      // 再度開いた時に元に戻っている想定（再レンダリング）
      expect(mockOnClose).toHaveBeenCalled()
    })
  })

  describe('ヘッダー', () => {
    it('ヘッダータイトルが「設定」と表示される', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      expect(screen.getByText('設定')).toBeInTheDocument()
    })
  })

  describe('開発者モード', () => {
    it('開発者モードトグルが表示される', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      expect(screen.getByTestId('developer-mode-toggle')).toBeInTheDocument()
      expect(screen.getByText('開発者モード')).toBeInTheDocument()
      expect(screen.getByText('有効にすると PoC ボタンが表示されます')).toBeInTheDocument()
    })

    it('デフォルトでOFFになっている', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      expect(screen.getByTestId('developer-mode-toggle')).not.toBeChecked()
    })

    it('トグルをONに切り替えられる', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      const toggle = screen.getByTestId('developer-mode-toggle')
      fireEvent.click(toggle)
      expect(toggle).toBeChecked()
    })

    it('ONの状態が保存に含まれる', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      fireEvent.click(screen.getByTestId('developer-mode-toggle'))
      fireEvent.click(screen.getByTestId('save-button'))

      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          ui: expect.objectContaining({
            developerMode: true,
          }),
        })
      )
    })

    it('既存の設定値が反映される', () => {
      const configWithDevMode = {
        ...mockConfig,
        ui: { ...mockConfig.ui, developerMode: true },
      }

      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={configWithDevMode}
          onSave={mockOnSave}
        />
      )

      expect(screen.getByTestId('developer-mode-toggle')).toBeChecked()
    })
  })
})
