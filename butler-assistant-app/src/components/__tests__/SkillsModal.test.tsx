import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SkillsModal } from '../SkillsModal'

// skillClient をモック
const mockGetConnections = vi.fn().mockResolvedValue([])
const mockStartGoogleOAuth = vi.fn()
const mockDisconnectGoogle = vi.fn().mockResolvedValue(undefined)

vi.mock('@/services/skillClient', () => ({
  skillClient: {
    getConnections: (...args: unknown[]) => mockGetConnections(...args),
    startGoogleOAuth: (...args: unknown[]) => mockStartGoogleOAuth(...args),
    disconnectGoogle: (...args: unknown[]) => mockDisconnectGoogle(...args),
    exchangeCode: vi.fn().mockResolvedValue(undefined),
  },
}))

describe('SkillsModal', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConnections.mockResolvedValue([])
  })

  describe('表示制御', () => {
    it('isOpenがfalseの場合は何も表示されない', () => {
      render(<SkillsModal isOpen={false} onClose={mockOnClose} />)
      expect(screen.queryByTestId('skills-panel')).not.toBeInTheDocument()
    })

    it('isOpenがtrueの場合はパネルが表示される', () => {
      render(<SkillsModal isOpen={true} onClose={mockOnClose} />)
      expect(screen.getByTestId('skills-panel')).toBeInTheDocument()
    })

    it('ヘッダータイトルが「スキル」と表示される', () => {
      render(<SkillsModal isOpen={true} onClose={mockOnClose} />)
      expect(screen.getByText('スキル')).toBeInTheDocument()
    })
  })

  describe('閉じる操作', () => {
    it('閉じるボタンで閉じる', () => {
      render(<SkillsModal isOpen={true} onClose={mockOnClose} />)
      fireEvent.click(screen.getByTestId('skills-close-button'))
      expect(mockOnClose).toHaveBeenCalled()
    })

    it('オーバーレイクリックで閉じる', () => {
      render(<SkillsModal isOpen={true} onClose={mockOnClose} />)
      fireEvent.click(screen.getByTestId('skills-overlay'))
      expect(mockOnClose).toHaveBeenCalled()
    })
  })

  describe('スキル一覧', () => {
    it('Google カレンダーの行が表示される', async () => {
      render(<SkillsModal isOpen={true} onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByTestId('skill-row-google')).toBeInTheDocument()
      })

      expect(screen.getByText('Google カレンダー')).toBeInTheDocument()
    })

    it('未接続時に「接続する」ボタンが表示される', async () => {
      render(<SkillsModal isOpen={true} onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByTestId('skill-connect-google')).toBeInTheDocument()
      })

      expect(screen.getByText('接続する')).toBeInTheDocument()
    })

    it('接続済みの場合「接続済み」バッジと「解除」ボタンが表示される', async () => {
      mockGetConnections.mockResolvedValue([
        { service: 'google', connectedAt: Date.now() },
      ])

      render(<SkillsModal isOpen={true} onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByTestId('skill-connected-google')).toBeInTheDocument()
      })

      expect(screen.getByText('接続済み')).toBeInTheDocument()
      expect(screen.getByTestId('skill-disconnect-google')).toBeInTheDocument()
    })

    it('「接続する」ボタンで OAuth フローが開始される', async () => {
      render(<SkillsModal isOpen={true} onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByTestId('skill-connect-google')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('skill-connect-google'))
      expect(mockStartGoogleOAuth).toHaveBeenCalledTimes(1)
    })

    it('「解除」ボタンで連携解除が実行される', async () => {
      mockGetConnections.mockResolvedValue([
        { service: 'google', connectedAt: Date.now() },
      ])

      render(<SkillsModal isOpen={true} onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByTestId('skill-disconnect-google')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('skill-disconnect-google'))

      await waitFor(() => {
        expect(mockDisconnectGoogle).toHaveBeenCalledTimes(1)
      })
    })
  })
})
