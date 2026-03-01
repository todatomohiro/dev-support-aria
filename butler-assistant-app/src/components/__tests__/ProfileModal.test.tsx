import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProfileModal } from '../ProfileModal'

const mockProfile = {
  nickname: '' as string,
  honorific: '' as '' | 'さん' | 'くん' | '様',
  gender: '' as '' | 'female' | 'male',
  aiName: '' as string,
}

describe('ProfileModal', () => {
  const mockOnClose = vi.fn()
  const mockOnSave = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('表示制御', () => {
    it('isOpenがfalseの場合は何も表示されない', () => {
      render(
        <ProfileModal
          isOpen={false}
          onClose={mockOnClose}
          profile={mockProfile}
          onSave={mockOnSave}
        />
      )

      expect(screen.queryByTestId('profile-panel')).not.toBeInTheDocument()
    })

    it('isOpenがtrueの場合はプロフィールパネルが表示される', () => {
      render(
        <ProfileModal
          isOpen={true}
          onClose={mockOnClose}
          profile={mockProfile}
          onSave={mockOnSave}
        />
      )

      expect(screen.getByTestId('profile-panel')).toBeInTheDocument()
    })
  })

  describe('プロフィール設定', () => {
    it('ニックネームを入力できる', () => {
      render(
        <ProfileModal
          isOpen={true}
          onClose={mockOnClose}
          profile={mockProfile}
          onSave={mockOnSave}
        />
      )

      const input = screen.getByTestId('nickname-input')
      fireEvent.change(input, { target: { value: '太郎' } })
      expect(input).toHaveValue('太郎')
    })

    it('ニックネームは20文字以内に制限される', () => {
      render(
        <ProfileModal
          isOpen={true}
          onClose={mockOnClose}
          profile={mockProfile}
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
        <ProfileModal
          isOpen={true}
          onClose={mockOnClose}
          profile={mockProfile}
          onSave={mockOnSave}
        />
      )

      const select = screen.getByTestId('honorific-select')
      fireEvent.change(select, { target: { value: 'さん' } })
      expect(select).toHaveValue('さん')
    })

    it('性別を選択できる', () => {
      render(
        <ProfileModal
          isOpen={true}
          onClose={mockOnClose}
          profile={mockProfile}
          onSave={mockOnSave}
        />
      )

      const select = screen.getByTestId('gender-select')
      fireEvent.change(select, { target: { value: 'female' } })
      expect(select).toHaveValue('female')
    })

    it('既存のプロフィール値が表示される', () => {
      const existingProfile = {
        nickname: '花子' as string,
        honorific: 'さん' as const,
        gender: 'female' as const,
      }

      render(
        <ProfileModal
          isOpen={true}
          onClose={mockOnClose}
          profile={existingProfile}
          onSave={mockOnSave}
        />
      )

      expect(screen.getByTestId('nickname-input')).toHaveValue('花子')
      expect(screen.getByTestId('honorific-select')).toHaveValue('さん')
      expect(screen.getByTestId('gender-select')).toHaveValue('female')
    })
  })

  describe('保存とキャンセル', () => {
    it('保存ボタンでプロフィールを保存する', () => {
      render(
        <ProfileModal
          isOpen={true}
          onClose={mockOnClose}
          profile={mockProfile}
          onSave={mockOnSave}
        />
      )

      fireEvent.change(screen.getByTestId('nickname-input'), { target: { value: '太郎' } })
      fireEvent.change(screen.getByTestId('honorific-select'), { target: { value: 'さん' } })
      fireEvent.change(screen.getByTestId('gender-select'), { target: { value: 'male' } })

      fireEvent.click(screen.getByTestId('profile-save-button'))

      expect(mockOnSave).toHaveBeenCalledWith({
        nickname: '太郎',
        honorific: 'さん',
        gender: 'male',
        aiName: '',
      })
      expect(mockOnClose).toHaveBeenCalled()
    })

    it('キャンセルボタンで閉じる', () => {
      render(
        <ProfileModal
          isOpen={true}
          onClose={mockOnClose}
          profile={mockProfile}
          onSave={mockOnSave}
        />
      )

      fireEvent.click(screen.getByTestId('profile-cancel-button'))
      expect(mockOnClose).toHaveBeenCalled()
      expect(mockOnSave).not.toHaveBeenCalled()
    })

    it('閉じるボタンで閉じる', () => {
      render(
        <ProfileModal
          isOpen={true}
          onClose={mockOnClose}
          profile={mockProfile}
          onSave={mockOnSave}
        />
      )

      fireEvent.click(screen.getByTestId('profile-close-button'))
      expect(mockOnClose).toHaveBeenCalled()
    })

    it('オーバーレイクリックで閉じる', () => {
      render(
        <ProfileModal
          isOpen={true}
          onClose={mockOnClose}
          profile={mockProfile}
          onSave={mockOnSave}
        />
      )

      fireEvent.click(screen.getByTestId('profile-overlay'))
      expect(mockOnClose).toHaveBeenCalled()
    })
  })
})
