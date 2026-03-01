import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '../appStore'
import type { Message } from '@/types'

describe('AppStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      messages: [],
      messagesCursor: null,
      hasEarlierMessages: false,
      isLoadingEarlier: false,
    })
  })

  describe('prependMessages', () => {
    it('メッセージを先頭に追加する', () => {
      const existing: Message[] = [
        { id: 'msg-3', role: 'user', content: 'C', timestamp: 300 },
        { id: 'msg-4', role: 'assistant', content: 'D', timestamp: 400 },
      ]
      useAppStore.setState({ messages: existing })

      const earlier: Message[] = [
        { id: 'msg-1', role: 'user', content: 'A', timestamp: 100 },
        { id: 'msg-2', role: 'assistant', content: 'B', timestamp: 200 },
      ]

      useAppStore.getState().prependMessages(earlier)

      const messages = useAppStore.getState().messages
      expect(messages).toHaveLength(4)
      expect(messages[0].id).toBe('msg-1')
      expect(messages[1].id).toBe('msg-2')
      expect(messages[2].id).toBe('msg-3')
      expect(messages[3].id).toBe('msg-4')
    })

    it('重複する ID のメッセージは追加しない', () => {
      const existing: Message[] = [
        { id: 'msg-2', role: 'assistant', content: 'B', timestamp: 200 },
        { id: 'msg-3', role: 'user', content: 'C', timestamp: 300 },
      ]
      useAppStore.setState({ messages: existing })

      const earlier: Message[] = [
        { id: 'msg-1', role: 'user', content: 'A', timestamp: 100 },
        { id: 'msg-2', role: 'assistant', content: 'B-dup', timestamp: 200 },
      ]

      useAppStore.getState().prependMessages(earlier)

      const messages = useAppStore.getState().messages
      expect(messages).toHaveLength(3)
      expect(messages[0].id).toBe('msg-1')
      expect(messages[1].id).toBe('msg-2')
      expect(messages[1].content).toBe('B') // 既存が維持される
    })

    it('空配列を渡しても既存メッセージは変更されない', () => {
      const existing: Message[] = [
        { id: 'msg-1', role: 'user', content: 'A', timestamp: 100 },
      ]
      useAppStore.setState({ messages: existing })

      useAppStore.getState().prependMessages([])

      expect(useAppStore.getState().messages).toHaveLength(1)
    })
  })

  describe('過去メッセージ読み込みステート', () => {
    it('setMessagesCursor でカーソルを更新できる', () => {
      useAppStore.getState().setMessagesCursor('MSG#2024-01-01')
      expect(useAppStore.getState().messagesCursor).toBe('MSG#2024-01-01')
    })

    it('setHasEarlierMessages でフラグを更新できる', () => {
      useAppStore.getState().setHasEarlierMessages(true)
      expect(useAppStore.getState().hasEarlierMessages).toBe(true)
    })

    it('setLoadingEarlier でローディング状態を更新できる', () => {
      useAppStore.getState().setLoadingEarlier(true)
      expect(useAppStore.getState().isLoadingEarlier).toBe(true)
    })

    it('clearMessages でカーソルとフラグもリセットされる', () => {
      useAppStore.setState({
        messages: [{ id: '1', role: 'user', content: 'A', timestamp: 100 }],
        messagesCursor: 'MSG#2024-01-01',
        hasEarlierMessages: true,
      })

      useAppStore.getState().clearMessages()

      const state = useAppStore.getState()
      expect(state.messages).toHaveLength(0)
      expect(state.messagesCursor).toBeNull()
      expect(state.hasEarlierMessages).toBe(false)
    })
  })
})
