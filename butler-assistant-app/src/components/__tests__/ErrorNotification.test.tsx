import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ErrorNotification, useErrorNotification } from '../ErrorNotification'
import { NetworkError, APIError, RateLimitError, ParseError, ValidationError, ModelLoadError } from '@/types'

describe('ErrorNotification', () => {
  const mockOnDismiss = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('表示制御', () => {
    it('errorがnullの場合は表示されない', () => {
      render(
        <ErrorNotification error={null} onDismiss={mockOnDismiss} />
      )

      expect(screen.queryByTestId('error-notification')).not.toBeInTheDocument()
    })

    it('エラーがある場合は表示される', () => {
      const error = new NetworkError('接続に失敗しました')

      render(
        <ErrorNotification error={error} onDismiss={mockOnDismiss} />
      )

      expect(screen.getByTestId('error-notification')).toBeInTheDocument()
    })
  })

  describe('エラータイプ別の表示', () => {
    it('NetworkErrorの場合、適切なタイトルが表示される', () => {
      const error = new NetworkError('ネットワークに接続できません')

      render(
        <ErrorNotification error={error} onDismiss={mockOnDismiss} />
      )

      expect(screen.getByTestId('error-title')).toHaveTextContent('ネットワークエラー')
      expect(screen.getByTestId('error-message')).toHaveTextContent('ネットワークに接続できません')
      expect(screen.getByTestId('error-notification')).toHaveAttribute('data-error-type', 'network')
    })

    it('RateLimitErrorの場合、適切なタイトルが表示される', () => {
      const error = new RateLimitError('リクエスト制限を超えました')

      render(
        <ErrorNotification error={error} onDismiss={mockOnDismiss} />
      )

      expect(screen.getByTestId('error-title')).toHaveTextContent('レート制限')
      expect(screen.getByTestId('error-notification')).toHaveAttribute('data-error-type', 'rateLimit')
    })

    it('APIErrorの場合、適切なタイトルが表示される', () => {
      const error = new APIError('APIリクエストが失敗しました', 500)

      render(
        <ErrorNotification error={error} onDismiss={mockOnDismiss} />
      )

      expect(screen.getByTestId('error-title')).toHaveTextContent('APIエラー')
      expect(screen.getByTestId('error-notification')).toHaveAttribute('data-error-type', 'api')
    })

    it('ParseErrorの場合、適切なタイトルが表示される', () => {
      const error = new ParseError('レスポンスの解析に失敗しました')

      render(
        <ErrorNotification error={error} onDismiss={mockOnDismiss} />
      )

      expect(screen.getByTestId('error-title')).toHaveTextContent('パースエラー')
      expect(screen.getByTestId('error-notification')).toHaveAttribute('data-error-type', 'parse')
    })

    it('ValidationErrorの場合、適切なタイトルが表示される', () => {
      const error = new ValidationError('入力値が不正です', [])

      render(
        <ErrorNotification error={error} onDismiss={mockOnDismiss} />
      )

      expect(screen.getByTestId('error-title')).toHaveTextContent('バリデーションエラー')
      expect(screen.getByTestId('error-notification')).toHaveAttribute('data-error-type', 'validation')
    })

    it('ModelLoadErrorの場合、適切なタイトルが表示される', () => {
      const error = new ModelLoadError('モデルの読み込みに失敗しました')

      render(
        <ErrorNotification error={error} onDismiss={mockOnDismiss} />
      )

      expect(screen.getByTestId('error-title')).toHaveTextContent('モデル読み込みエラー')
      expect(screen.getByTestId('error-notification')).toHaveAttribute('data-error-type', 'modelLoad')
    })
  })

  describe('メッセージ表示', () => {
    it('エラーメッセージが表示される', () => {
      const error = new NetworkError('サーバーに接続できません')

      render(
        <ErrorNotification error={error} onDismiss={mockOnDismiss} />
      )

      expect(screen.getByTestId('error-message')).toHaveTextContent('サーバーに接続できません')
    })

    it('メッセージが空の場合はデフォルトメッセージが表示される', () => {
      const error = new NetworkError('')

      render(
        <ErrorNotification error={error} onDismiss={mockOnDismiss} />
      )

      expect(screen.getByTestId('error-message')).toHaveTextContent('予期しないエラーが発生しました')
    })
  })

  describe('手動クローズ', () => {
    it('閉じるボタンをクリックするとonDismissが呼ばれる', async () => {
      const error = new NetworkError('テストエラー')

      render(
        <ErrorNotification error={error} onDismiss={mockOnDismiss} autoDismissDelay={0} />
      )

      fireEvent.click(screen.getByTestId('dismiss-button'))

      // アニメーション完了を待つ
      await act(async () => {
        vi.advanceTimersByTime(300)
      })

      expect(mockOnDismiss).toHaveBeenCalledTimes(1)
    })
  })

  describe('自動クローズ', () => {
    it('指定時間後に自動的にonDismissが呼ばれる', async () => {
      const error = new NetworkError('テストエラー')

      render(
        <ErrorNotification error={error} onDismiss={mockOnDismiss} autoDismissDelay={5000} />
      )

      // 5秒経過
      await act(async () => {
        vi.advanceTimersByTime(5000)
      })

      // アニメーション完了を待つ
      await act(async () => {
        vi.advanceTimersByTime(300)
      })

      expect(mockOnDismiss).toHaveBeenCalledTimes(1)
    })

    it('autoDismissDelayが0の場合は自動クローズしない', async () => {
      const error = new NetworkError('テストエラー')

      render(
        <ErrorNotification error={error} onDismiss={mockOnDismiss} autoDismissDelay={0} />
      )

      // 10秒経過しても閉じない
      await act(async () => {
        vi.advanceTimersByTime(10000)
      })

      expect(mockOnDismiss).not.toHaveBeenCalled()
      expect(screen.getByTestId('error-notification')).toBeInTheDocument()
    })

    it('プログレスバーが表示される', () => {
      const error = new NetworkError('テストエラー')

      render(
        <ErrorNotification error={error} onDismiss={mockOnDismiss} autoDismissDelay={5000} />
      )

      expect(screen.getByTestId('progress-bar')).toBeInTheDocument()
    })

    it('autoDismissDelayが0の場合、プログレスバーが表示されない', () => {
      const error = new NetworkError('テストエラー')

      render(
        <ErrorNotification error={error} onDismiss={mockOnDismiss} autoDismissDelay={0} />
      )

      expect(screen.queryByTestId('progress-bar')).not.toBeInTheDocument()
    })
  })

  describe('アニメーション', () => {
    it('閉じるときにアニメーションが適用される', async () => {
      const error = new NetworkError('テストエラー')

      render(
        <ErrorNotification error={error} onDismiss={mockOnDismiss} autoDismissDelay={0} />
      )

      const notification = screen.getByTestId('error-notification')
      expect(notification).toHaveClass('translate-x-0', 'opacity-100')

      fireEvent.click(screen.getByTestId('dismiss-button'))

      // アニメーション開始
      expect(notification).toHaveClass('translate-x-full', 'opacity-0')

      // アニメーション完了
      await act(async () => {
        vi.advanceTimersByTime(300)
      })

      expect(mockOnDismiss).toHaveBeenCalled()
    })
  })

  describe('エラーの更新', () => {
    it('新しいエラーが設定されると再表示される', async () => {
      const error1 = new NetworkError('エラー1')
      const error2 = new APIError('エラー2', 500)

      const { rerender } = render(
        <ErrorNotification error={error1} onDismiss={mockOnDismiss} autoDismissDelay={0} />
      )

      expect(screen.getByTestId('error-message')).toHaveTextContent('エラー1')

      rerender(
        <ErrorNotification error={error2} onDismiss={mockOnDismiss} autoDismissDelay={0} />
      )

      expect(screen.getByTestId('error-message')).toHaveTextContent('エラー2')
      expect(screen.getByTestId('error-notification')).toHaveAttribute('data-error-type', 'api')
    })
  })
})

describe('useErrorNotification', () => {
  it('notificationPropsを正しく返す', () => {
    const error = new NetworkError('テストエラー')
    const clearError = vi.fn()

    const { notificationProps } = useErrorNotification(error, clearError)

    expect(notificationProps.error).toBe(error)
    expect(notificationProps.onDismiss).toBe(clearError)
  })

  it('errorがnullの場合もnotificationPropsを返す', () => {
    const clearError = vi.fn()

    const { notificationProps } = useErrorNotification(null, clearError)

    expect(notificationProps.error).toBeNull()
    expect(notificationProps.onDismiss).toBe(clearError)
  })
})
