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
  timestamp: number,
  rawResponse?: string
): Message => ({
  id,
  content,
  role,
  timestamp,
  ...(rawResponse ? { rawResponse } : {}),
})

/** ChatUI のデフォルト props */
const defaultProps = {
  messages: [] as Message[],
  isLoading: false,
  onSendMessage: vi.fn(),
  ttsEnabled: false,
  onToggleTts: vi.fn(),
  cameraEnabled: false,
  onToggleCamera: vi.fn(),
  hasEarlierMessages: false,
  isLoadingEarlier: false,
  onLoadEarlier: vi.fn(),
}

/** ChatUI をデフォルト props 付きでレンダリング */
const renderChatUI = (overrides: Partial<typeof defaultProps> = {}) =>
  render(<ChatUI {...defaultProps} {...overrides} />)

describe('ChatUI', () => {
  describe('メッセージ表示', () => {
    it('メッセージが正しく表示される', () => {
      const messages: Message[] = [
        createMessage('1', 'こんにちは', 'user', Date.now()),
        createMessage('2', 'ご主人様、ようこそ', 'assistant', Date.now()),
      ]

      renderChatUI({ messages })

      expect(screen.getByText('こんにちは')).toBeInTheDocument()
      expect(screen.getByText('ご主人様、ようこそ')).toBeInTheDocument()
    })

    it('空のメッセージリストでも正常に表示される', () => {
      renderChatUI()

      expect(screen.queryByTestId('message-bubble')).not.toBeInTheDocument()
    })
  })

  describe('ローディング状態', () => {
    it('ローディング中はインジケーターが表示される', () => {
      renderChatUI({ isLoading: true })

      expect(screen.getByTestId('loading-indicator')).toBeInTheDocument()
    })

    it('ローディング中でないときはインジケーターが非表示', () => {
      renderChatUI()

      expect(screen.queryByTestId('loading-indicator')).not.toBeInTheDocument()
    })

    it('ローディング中は入力が無効化される', () => {
      renderChatUI({ isLoading: true })

      const input = screen.getByTestId('chat-input')
      expect(input).toBeDisabled()
    })
  })

  describe('メッセージ送信', () => {
    it('送信ボタンクリックでonSendMessageが呼ばれる', () => {
      const onSendMessage = vi.fn()
      renderChatUI({ onSendMessage })

      const input = screen.getByTestId('chat-input')
      const sendButton = screen.getByTestId('send-button')

      fireEvent.change(input, { target: { value: 'テストメッセージ' } })
      fireEvent.click(sendButton)

      expect(onSendMessage).toHaveBeenCalledWith('テストメッセージ', undefined)
    })

    it('Enterキーでメッセージを送信できる', () => {
      const onSendMessage = vi.fn()
      renderChatUI({ onSendMessage })

      const input = screen.getByTestId('chat-input')

      fireEvent.change(input, { target: { value: 'テストメッセージ' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(onSendMessage).toHaveBeenCalledWith('テストメッセージ', undefined)
    })

    it('Shift+Enterでは送信されない', () => {
      const onSendMessage = vi.fn()
      renderChatUI({ onSendMessage })

      const input = screen.getByTestId('chat-input')

      fireEvent.change(input, { target: { value: 'テストメッセージ' } })
      fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })

      expect(onSendMessage).not.toHaveBeenCalled()
    })

    it('空のメッセージは送信できない', () => {
      const onSendMessage = vi.fn()
      renderChatUI({ onSendMessage })

      const sendButton = screen.getByTestId('send-button')

      fireEvent.click(sendButton)

      expect(onSendMessage).not.toHaveBeenCalled()
    })

    it('送信後に入力フィールドがクリアされる', () => {
      renderChatUI()

      const input = screen.getByTestId('chat-input') as HTMLTextAreaElement

      fireEvent.change(input, { target: { value: 'テストメッセージ' } })
      fireEvent.click(screen.getByTestId('send-button'))

      expect(input.value).toBe('')
    })
  })

  describe('開発者モード JSON 表示', () => {
    const rawJson = JSON.stringify({ text: 'こんにちは', motion: 'greeting', emotion: 'happy' }, null, 2)

    it('developerMode=false の場合、JSON ボタンが表示されない', () => {
      const messages: Message[] = [
        createMessage('1', 'こんにちは', 'assistant', Date.now(), rawJson),
      ]

      renderChatUI({ messages, developerMode: false })

      expect(screen.queryByTestId('raw-json-toggle')).not.toBeInTheDocument()
    })

    it('developerMode=true かつ rawResponse あり → JSON ボタンが表示される', () => {
      const messages: Message[] = [
        createMessage('1', 'こんにちは', 'assistant', Date.now(), rawJson),
      ]

      renderChatUI({ messages, developerMode: true })

      expect(screen.getByTestId('raw-json-toggle')).toBeInTheDocument()
    })

    it('JSON ボタンクリックで raw JSON が展開・折りたたみされる', () => {
      const messages: Message[] = [
        createMessage('1', 'こんにちは', 'assistant', Date.now(), rawJson),
      ]

      renderChatUI({ messages, developerMode: true })

      // 初期状態では raw JSON が表示されていない
      expect(screen.queryByTestId('raw-json-content')).not.toBeInTheDocument()

      // JSON ボタンをクリックして展開
      fireEvent.click(screen.getByTestId('raw-json-toggle'))
      expect(screen.getByTestId('raw-json-content')).toBeInTheDocument()
      expect(screen.getByTestId('raw-json-content').textContent).toBe(rawJson)

      // もう一度クリックして折りたたみ
      fireEvent.click(screen.getByTestId('raw-json-toggle'))
      expect(screen.queryByTestId('raw-json-content')).not.toBeInTheDocument()
    })

    it('ユーザーメッセージには JSON ボタンが表示されない', () => {
      const messages: Message[] = [
        createMessage('1', 'テスト', 'user', Date.now(), rawJson),
      ]

      renderChatUI({ messages, developerMode: true })

      expect(screen.queryByTestId('raw-json-toggle')).not.toBeInTheDocument()
    })
  })

  describe('URL リンク化', () => {
    it('URL を含むアシスタントメッセージに <a> タグがレンダリングされる', () => {
      const messages: Message[] = [
        createMessage('1', 'こちらを参照: https://example.com/path', 'assistant', Date.now()),
      ]

      renderChatUI({ messages })

      const link = screen.getByRole('link')
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute('href', 'https://example.com/path')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      expect(link).toHaveTextContent('https://example.com/path')
    })

    it('URL を含むユーザーメッセージでもリンク化される', () => {
      const messages: Message[] = [
        createMessage('1', 'http://test.org を見て', 'user', Date.now()),
      ]

      renderChatUI({ messages })

      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', 'http://test.org')
    })

    it('URL を含まないメッセージには <a> タグがない', () => {
      const messages: Message[] = [
        createMessage('1', 'URLのないメッセージです', 'assistant', Date.now()),
      ]

      renderChatUI({ messages })

      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })

    it('複数の URL が含まれる場合、すべてリンク化される', () => {
      const messages: Message[] = [
        createMessage('1', 'リンク1: https://a.com リンク2: https://b.com', 'assistant', Date.now()),
      ]

      renderChatUI({ messages })

      const links = screen.getAllByRole('link')
      expect(links).toHaveLength(2)
      expect(links[0]).toHaveAttribute('href', 'https://a.com')
      expect(links[1]).toHaveAttribute('href', 'https://b.com')
    })
  })

  describe('過去メッセージ読み込み', () => {
    it('hasEarlierMessages=true の場合、読み込みボタンが表示される', () => {
      renderChatUI({ hasEarlierMessages: true })

      expect(screen.getByTestId('load-earlier-button')).toBeInTheDocument()
      expect(screen.getByText('過去のメッセージを読み込む')).toBeInTheDocument()
    })

    it('hasEarlierMessages=false の場合、読み込みボタンが表示されない', () => {
      renderChatUI({ hasEarlierMessages: false })

      expect(screen.queryByTestId('load-earlier-button')).not.toBeInTheDocument()
    })

    it('ボタンクリックで onLoadEarlier が呼ばれる', () => {
      const onLoadEarlier = vi.fn()
      renderChatUI({ hasEarlierMessages: true, onLoadEarlier })

      fireEvent.click(screen.getByTestId('load-earlier-button'))

      expect(onLoadEarlier).toHaveBeenCalledTimes(1)
    })

    it('isLoadingEarlier=true の場合、ボタンが無効化されスピナーが表示される', () => {
      renderChatUI({ hasEarlierMessages: true, isLoadingEarlier: true })

      const button = screen.getByTestId('load-earlier-button')
      expect(button).toBeDisabled()
      expect(screen.getByText('読み込み中...')).toBeInTheDocument()
    })

    it('isLoadingEarlier=true の場合、ボタンクリックで onLoadEarlier が呼ばれない', () => {
      const onLoadEarlier = vi.fn()
      renderChatUI({ hasEarlierMessages: true, isLoadingEarlier: true, onLoadEarlier })

      fireEvent.click(screen.getByTestId('load-earlier-button'))

      expect(onLoadEarlier).not.toHaveBeenCalled()
    })
  })

  describe('クイックリプライ', () => {
    it('suggestedReplies がある場合にボタンが表示される', () => {
      const messages: Message[] = [
        { ...createMessage('1', '好き？嫌い？', 'assistant', Date.now()), suggestedReplies: ['好き', '嫌い', 'どちらでもない'] },
      ]

      renderChatUI({ messages })

      const buttons = screen.getAllByTestId('quick-reply-button')
      expect(buttons).toHaveLength(3)
      expect(buttons[0]).toHaveTextContent('好き')
      expect(buttons[1]).toHaveTextContent('嫌い')
      expect(buttons[2]).toHaveTextContent('どちらでもない')
    })

    it('ボタンタップで onSendMessage が呼ばれる', () => {
      const onSendMessage = vi.fn()
      const messages: Message[] = [
        { ...createMessage('1', '好き？', 'assistant', Date.now()), suggestedReplies: ['好き', '嫌い'] },
      ]

      renderChatUI({ messages, onSendMessage })

      fireEvent.click(screen.getAllByTestId('quick-reply-button')[0])
      expect(onSendMessage).toHaveBeenCalledWith('好き')
    })

    it('suggestedReplies がない場合にボタンが表示されない', () => {
      const messages: Message[] = [
        createMessage('1', 'こんにちは', 'assistant', Date.now()),
      ]

      renderChatUI({ messages })

      expect(screen.queryByTestId('quick-reply-button')).not.toBeInTheDocument()
    })

    it('ローディング中はボタンが非表示', () => {
      const messages: Message[] = [
        { ...createMessage('1', '好き？', 'assistant', Date.now()), suggestedReplies: ['好き', '嫌い'] },
      ]

      renderChatUI({ messages, isLoading: true })

      expect(screen.queryByTestId('quick-reply-button')).not.toBeInTheDocument()
    })

    it('最新メッセージがユーザーの場合はボタンが表示されない', () => {
      const messages: Message[] = [
        { ...createMessage('1', '好き？', 'assistant', Date.now() - 1000), suggestedReplies: ['好き', '嫌い'] },
        createMessage('2', '好き', 'user', Date.now()),
      ]

      renderChatUI({ messages })

      expect(screen.queryByTestId('quick-reply-button')).not.toBeInTheDocument()
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
                {...defaultProps}
                messages={sortedMessages}
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
                {...defaultProps}
                onSendMessage={onSendMessage}
              />
            )

            const input = screen.getByTestId('chat-input')
            const sendButton = screen.getByTestId('send-button')

            fireEvent.change(input, { target: { value: text } })
            fireEvent.click(sendButton)

            expect(onSendMessage).toHaveBeenCalledWith(text.trim(), undefined)

            // 各イテレーション後にクリーンアップ
            unmount()
          }
        ),
        { numRuns: 50 }
      )
    })
  })
})
