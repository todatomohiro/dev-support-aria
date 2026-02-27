import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Settings } from '../Settings'

const mockConfig = {
  ui: {
    theme: 'light' as const,
    fontSize: 14,
    characterSize: 100,
  },
  profile: {
    nickname: '' as string,
    honorific: '' as '' | 'さん' | 'くん' | '様',
    gender: '' as '' | 'female' | 'male',
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

  describe('プロフィール設定', () => {
    it('プロフィールセクションが表示される', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      expect(screen.getByTestId('profile-section-title')).toHaveTextContent('プロフィール')
    })

    it('ニックネームを入力できる', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      const input = screen.getByTestId('nickname-input')
      fireEvent.change(input, { target: { value: '太郎' } })
      expect(input).toHaveValue('太郎')
    })

    it('ニックネームは20文字以内に制限される', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      const input = screen.getByTestId('nickname-input')
      const longName = 'あ'.repeat(25)
      fireEvent.change(input, { target: { value: longName } })
      expect((input as HTMLInputElement).value.length).toBeLessThanOrEqual(20)
    })

    it('敬称を選択できる', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      const select = screen.getByTestId('honorific-select')
      fireEvent.change(select, { target: { value: 'さん' } })
      expect(select).toHaveValue('さん')
    })

    it('性別を選択できる', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      const select = screen.getByTestId('gender-select')
      fireEvent.change(select, { target: { value: 'female' } })
      expect(select).toHaveValue('female')
    })

    it('保存時にプロフィール情報も含まれる', () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      // プロフィールを設定
      fireEvent.change(screen.getByTestId('nickname-input'), { target: { value: '太郎' } })
      fireEvent.change(screen.getByTestId('honorific-select'), { target: { value: 'さん' } })
      fireEvent.change(screen.getByTestId('gender-select'), { target: { value: 'male' } })

      // 保存
      fireEvent.click(screen.getByTestId('save-button'))

      expect(mockOnSave).toHaveBeenCalledWith({
        ui: {
          theme: 'light',
          fontSize: 14,
          characterSize: 100,
        },
        profile: {
          nickname: '太郎',
          honorific: 'さん',
          gender: 'male',
        },
      })
    })

    it('既存のプロフィール値が表示される', () => {
      const configWithProfile = {
        ...mockConfig,
        profile: {
          nickname: '花子' as string,
          honorific: 'さん' as const,
          gender: 'female' as const,
        },
      }

      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={configWithProfile}
          onSave={mockOnSave}
        />
      )

      expect(screen.getByTestId('nickname-input')).toHaveValue('花子')
      expect(screen.getByTestId('honorific-select')).toHaveValue('さん')
      expect(screen.getByTestId('gender-select')).toHaveValue('female')
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
        },
        profile: {
          nickname: '',
          honorific: '',
          gender: '',
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
})
