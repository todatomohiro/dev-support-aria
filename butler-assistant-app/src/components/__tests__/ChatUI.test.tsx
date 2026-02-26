import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import fc from 'fast-check'
import { ChatUI } from '../ChatUI'
import type { Message } from '@/types'

// 各テスト後にクリーンアップ
afterEach(() => {
  cleanup()
})

// テスト用のメッセージを生成
const createMessage = (
  id: string,
  content: string,
  role: 'user' | 'assistant',
  timestamp: number
): Message => ({
  id,
  content,
  role,
  timestamp,
})

describe('ChatUI', () => {
  describe('メッセージ表示', () => {
    it('メッセージが正しく表示される', () => {
      const messages: Message[] = [
        createMessage('1', 'こんにちは', 'user', Date.now()),
        createMessage('2', 'ご主人様、ようこそ', 'assistant', Date.now()),
      ]

      render(
        <ChatUI messages={messages} isLoading={false} onSendMessage={() => {}} />
      )

      expect(screen.getByText('こんにちは')).toBeInTheDocument()
      expect(screen.getByText('ご主人様、ようこそ')).toBeInTheDocument()
    })

    it('空のメッセージリストでも正常に表示される', () => {
      render(<ChatUI messages={[]} isLoading={false} onSendMessage={() => {}} />)

      expect(screen.queryByTestId('message-bubble')).not.toBeInTheDocument()
    })
  })

  describe('ローディング状態', () => {
    it('ローディング中はインジケーターが表示される', () => {
      render(<ChatUI messages={[]} isLoading={true} onSendMessage={() => {}} />)

      expect(screen.getByTestId('loading-indicator')).toBeInTheDocument()
    })

    it('ローディング中でないときはインジケーターが非表示', () => {
      render(<ChatUI messages={[]} isLoading={false} onSendMessage={() => {}} />)

      expect(screen.queryByTestId('loading-indicator')).not.toBeInTheDocument()
    })

    it('ローディング中は入力が無効化される', () => {
      render(<ChatUI messages={[]} isLoading={true} onSendMessage={() => {}} />)

      const input = screen.getByTestId('chat-input')
      expect(input).toBeDisabled()
    })
  })

  describe('メッセージ送信', () => {
    it('送信ボタンクリックでonSendMessageが呼ばれる', () => {
      const onSendMessage = vi.fn()
      render(
        <ChatUI messages={[]} isLoading={false} onSendMessage={onSendMessage} />
      )

      const input = screen.getByTestId('chat-input')
      const sendButton = screen.getByTestId('send-button')

      fireEvent.change(input, { target: { value: 'テストメッセージ' } })
      fireEvent.click(sendButton)

      expect(onSendMessage).toHaveBeenCalledWith('テストメッセージ')
    })

    it('Enterキーでメッセージを送信できる', () => {
      const onSendMessage = vi.fn()
      render(
        <ChatUI messages={[]} isLoading={false} onSendMessage={onSendMessage} />
      )

      const input = screen.getByTestId('chat-input')

      fireEvent.change(input, { target: { value: 'テストメッセージ' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(onSendMessage).toHaveBeenCalledWith('テストメッセージ')
    })

    it('Shift+Enterでは送信されない', () => {
      const onSendMessage = vi.fn()
      render(
        <ChatUI messages={[]} isLoading={false} onSendMessage={onSendMessage} />
      )

      const input = screen.getByTestId('chat-input')

      fireEvent.change(input, { target: { value: 'テストメッセージ' } })
      fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })

      expect(onSendMessage).not.toHaveBeenCalled()
    })

    it('空のメッセージは送信できない', () => {
      const onSendMessage = vi.fn()
      render(
        <ChatUI messages={[]} isLoading={false} onSendMessage={onSendMessage} />
      )

      const sendButton = screen.getByTestId('send-button')

      fireEvent.click(sendButton)

      expect(onSendMessage).not.toHaveBeenCalled()
    })

    it('送信後に入力フィールドがクリアされる', () => {
      render(
        <ChatUI messages={[]} isLoading={false} onSendMessage={() => {}} />
      )

      const input = screen.getByTestId('chat-input') as HTMLTextAreaElement

      fireEvent.change(input, { target: { value: 'テストメッセージ' } })
      fireEvent.click(screen.getByTestId('send-button'))

      expect(input.value).toBe('')
    })
  })

  // Property-based tests
  describe('Property Tests', () => {
    // Property 1: メッセージ表示の時系列順序保持
    it('Feature: butler-assistant-app, Property 1: メッセージは時系列順に表示される', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              id: fc.uuid(),
              content: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
              role: fc.constantFrom('user', 'assistant') as fc.Arbitrary<'user' | 'assistant'>,
              timestamp: fc.integer({ min: 0, max: Date.now() }),
            }),
            { minLength: 2, maxLength: 10 }
          ),
          (messages) => {
            // タイムスタンプ順にソート
            const sortedMessages = [...messages].sort((a, b) => a.timestamp - b.timestamp)

            const { container, unmount } = render(
              <ChatUI
                messages={sortedMessages}
                isLoading={false}
                onSendMessage={() => {}}
              />
            )

            const bubbles = container.querySelectorAll('[data-testid="message-bubble"]')
            const timestamps = Array.from(bubbles).map((b) =>
              parseInt(b.getAttribute('data-timestamp') || '0')
            )

            // 表示順がタイムスタンプ順と一致することを確認
            for (let i = 1; i < timestamps.length; i++) {
              expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1])
            }

            // 各イテレーション後にクリーンアップ
            unmount()
          }
        ),
        { numRuns: 50 }
      )
    })

    // Property 2: メッセージ送信後の履歴追加
    it('Feature: butler-assistant-app, Property 2: 任意のテキストを送信できる', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
          (text) => {
            const onSendMessage = vi.fn()

            const { unmount } = render(
              <ChatUI
                messages={[]}
                isLoading={false}
                onSendMessage={onSendMessage}
              />
            )

            const input = screen.getByTestId('chat-input')
            const sendButton = screen.getByTestId('send-button')

            fireEvent.change(input, { target: { value: text } })
            fireEvent.click(sendButton)

            expect(onSendMessage).toHaveBeenCalledWith(text.trim())

            // 各イテレーション後にクリーンアップ
            unmount()
          }
        ),
        { numRuns: 50 }
      )
    })
  })
})
