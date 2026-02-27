import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { Settings } from '@/components'
import { useAppStore } from '@/stores'

describe('設定フロー統合テスト', () => {
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

  const mockOnClose = vi.fn()
  const mockOnSave = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
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

    it('キャラクターサイズを変更できる', async () => {
      render(
        <Settings
          isOpen={true}
          onClose={mockOnClose}
          config={mockConfig}
          onSave={mockOnSave}
        />
      )

      // キャラクターサイズを変更
      const slider = screen.getByTestId('character-size-slider')
      fireEvent.change(slider, { target: { value: '120' } })

      // 保存
      await act(async () => {
        fireEvent.click(screen.getByTestId('save-button'))
      })

      // onSaveが呼ばれたことを確認
      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            ui: expect.objectContaining({
              characterSize: 120,
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

      // テーマを変更
      fireEvent.click(screen.getByTestId('theme-dark'))

      // キャンセルボタンをクリック
      fireEvent.click(screen.getByTestId('cancel-button'))

      // 保存されていないことを確認
      expect(mockOnSave).not.toHaveBeenCalled()
      expect(mockOnClose).toHaveBeenCalled()
    })
  })
})

describe('設定とストアの連携', () => {
  beforeEach(() => {
    const store = useAppStore.getState()
    store.updateConfig({
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
      ui: {
        theme: 'dark',
      },
    })

    const state = useAppStore.getState()
    expect(state.config.ui.theme).toBe('dark')
    // 変更されていない値は維持される
    expect(state.config.ui.fontSize).toBe(14)
  })
})
