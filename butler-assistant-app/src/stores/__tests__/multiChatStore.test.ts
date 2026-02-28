import { describe, it, expect, beforeEach } from 'vitest'
import { useMultiChatStore } from '../multiChatStore'
import type { FriendLink, ConversationSummary, ConversationMessage } from '@/types'

describe('multiChatStore', () => {
  beforeEach(() => {
    // ストアをリセット
    useMultiChatStore.getState().reset()
  })

  const mockFriends: FriendLink[] = [
    { friendUserId: 'user-1', displayName: 'Friend 1', linkedAt: 1700000000000 },
    { friendUserId: 'user-2', displayName: 'Friend 2', linkedAt: 1700100000000 },
  ]

  const mockConversations: ConversationSummary[] = [
    { conversationId: 'conv_1', otherUserId: 'user-1', otherDisplayName: 'Friend 1', lastMessage: 'Hello', updatedAt: 1700000000000 },
    { conversationId: 'conv_2', otherUserId: 'user-2', otherDisplayName: 'Friend 2', lastMessage: 'Hi', updatedAt: 1700100000000 },
  ]

  const mockMessages: ConversationMessage[] = [
    { id: 'msg-1', senderId: 'user-1', senderName: 'Friend 1', content: 'Hello', timestamp: 1700000000000, type: 'text' },
    { id: 'msg-2', senderId: 'me', senderName: 'Me', content: 'Hi!', timestamp: 1700000001000, type: 'text' },
  ]

  describe('初期状態', () => {
    it('friends が空配列で開始する', () => {
      expect(useMultiChatStore.getState().friends).toEqual([])
    })

    it('myFriendCode が null で開始する', () => {
      expect(useMultiChatStore.getState().myFriendCode).toBeNull()
    })

    it('conversations が空配列で開始する', () => {
      expect(useMultiChatStore.getState().conversations).toEqual([])
    })

    it('activeConversationId が null で開始する', () => {
      expect(useMultiChatStore.getState().activeConversationId).toBeNull()
    })

    it('activeMessages が空配列で開始する', () => {
      expect(useMultiChatStore.getState().activeMessages).toEqual([])
    })

    it('isSending が false で開始する', () => {
      expect(useMultiChatStore.getState().isSending).toBe(false)
    })

    it('error が null で開始する', () => {
      expect(useMultiChatStore.getState().error).toBeNull()
    })
  })

  describe('setFriends', () => {
    it('フレンド一覧を設定する', () => {
      useMultiChatStore.getState().setFriends(mockFriends)
      expect(useMultiChatStore.getState().friends).toEqual(mockFriends)
    })
  })

  describe('setMyFriendCode', () => {
    it('フレンドコードを設定する', () => {
      useMultiChatStore.getState().setMyFriendCode('ABCD1234')
      expect(useMultiChatStore.getState().myFriendCode).toBe('ABCD1234')
    })

    it('null に設定できる', () => {
      useMultiChatStore.getState().setMyFriendCode('ABCD1234')
      useMultiChatStore.getState().setMyFriendCode(null)
      expect(useMultiChatStore.getState().myFriendCode).toBeNull()
    })
  })

  describe('setConversations', () => {
    it('会話一覧を設定する', () => {
      useMultiChatStore.getState().setConversations(mockConversations)
      expect(useMultiChatStore.getState().conversations).toEqual(mockConversations)
    })
  })

  describe('setActiveConversation', () => {
    it('アクティブな会話を設定する', () => {
      useMultiChatStore.getState().setActiveConversation('conv_1')
      expect(useMultiChatStore.getState().activeConversationId).toBe('conv_1')
    })

    it('null でクリアする', () => {
      useMultiChatStore.getState().setActiveConversation('conv_1')
      useMultiChatStore.getState().setActiveConversation(null)
      expect(useMultiChatStore.getState().activeConversationId).toBeNull()
    })
  })

  describe('setActiveMessages', () => {
    it('アクティブな会話のメッセージを設定する', () => {
      useMultiChatStore.getState().setActiveMessages(mockMessages)
      expect(useMultiChatStore.getState().activeMessages).toEqual(mockMessages)
    })
  })

  describe('appendMessages', () => {
    it('新しいメッセージを末尾に追加する', () => {
      useMultiChatStore.getState().setActiveMessages(mockMessages)

      const newMessage: ConversationMessage = {
        id: 'msg-3', senderId: 'user-1', senderName: 'Friend 1', content: 'New', timestamp: 1700000002000, type: 'text',
      }
      useMultiChatStore.getState().appendMessages([newMessage])

      const messages = useMultiChatStore.getState().activeMessages
      expect(messages).toHaveLength(3)
      expect(messages[2]).toEqual(newMessage)
    })

    it('重複するメッセージは追加しない', () => {
      useMultiChatStore.getState().setActiveMessages(mockMessages)

      // 既存のメッセージを再度追加しようとする
      useMultiChatStore.getState().appendMessages([mockMessages[0]])

      expect(useMultiChatStore.getState().activeMessages).toHaveLength(2)
    })

    it('新規と重複が混在する場合、新規のみ追加する', () => {
      useMultiChatStore.getState().setActiveMessages(mockMessages)

      const newMessage: ConversationMessage = {
        id: 'msg-3', senderId: 'user-1', senderName: 'Friend 1', content: 'New', timestamp: 1700000002000, type: 'text',
      }
      useMultiChatStore.getState().appendMessages([mockMessages[0], newMessage])

      expect(useMultiChatStore.getState().activeMessages).toHaveLength(3)
    })

    it('すべて重複する場合は状態を変更しない', () => {
      useMultiChatStore.getState().setActiveMessages(mockMessages)
      const before = useMultiChatStore.getState().activeMessages

      useMultiChatStore.getState().appendMessages(mockMessages)

      expect(useMultiChatStore.getState().activeMessages).toBe(before)
    })
  })

  describe('setLastPollTimestamp', () => {
    it('タイムスタンプを設定する', () => {
      useMultiChatStore.getState().setLastPollTimestamp(1700000000000)
      expect(useMultiChatStore.getState().lastPollTimestamp).toBe(1700000000000)
    })
  })

  describe('setSending', () => {
    it('送信中フラグを設定する', () => {
      useMultiChatStore.getState().setSending(true)
      expect(useMultiChatStore.getState().isSending).toBe(true)

      useMultiChatStore.getState().setSending(false)
      expect(useMultiChatStore.getState().isSending).toBe(false)
    })
  })

  describe('setError', () => {
    it('エラーメッセージを設定する', () => {
      useMultiChatStore.getState().setError('テストエラー')
      expect(useMultiChatStore.getState().error).toBe('テストエラー')
    })

    it('null でクリアする', () => {
      useMultiChatStore.getState().setError('テストエラー')
      useMultiChatStore.getState().setError(null)
      expect(useMultiChatStore.getState().error).toBeNull()
    })
  })

  describe('setLoadingConversations', () => {
    it('会話一覧のローディング状態を設定する', () => {
      useMultiChatStore.getState().setLoadingConversations(true)
      expect(useMultiChatStore.getState().isLoadingConversations).toBe(true)

      useMultiChatStore.getState().setLoadingConversations(false)
      expect(useMultiChatStore.getState().isLoadingConversations).toBe(false)
    })
  })

  describe('setLoadingMessages', () => {
    it('メッセージのローディング状態を設定する', () => {
      useMultiChatStore.getState().setLoadingMessages(true)
      expect(useMultiChatStore.getState().isLoadingMessages).toBe(true)

      useMultiChatStore.getState().setLoadingMessages(false)
      expect(useMultiChatStore.getState().isLoadingMessages).toBe(false)
    })
  })

  describe('incrementUnread', () => {
    it('未読カウントを1加算する', () => {
      useMultiChatStore.getState().incrementUnread('conv_1')
      expect(useMultiChatStore.getState().unreadCounts).toEqual({ conv_1: 1 })
    })

    it('指定したカウント分加算する', () => {
      useMultiChatStore.getState().incrementUnread('conv_1', 5)
      expect(useMultiChatStore.getState().unreadCounts).toEqual({ conv_1: 5 })
    })

    it('既存カウントに加算する', () => {
      useMultiChatStore.getState().incrementUnread('conv_1')
      useMultiChatStore.getState().incrementUnread('conv_1')
      expect(useMultiChatStore.getState().unreadCounts).toEqual({ conv_1: 2 })
    })

    it('異なる会話は独立してカウントする', () => {
      useMultiChatStore.getState().incrementUnread('conv_1')
      useMultiChatStore.getState().incrementUnread('conv_2', 3)
      expect(useMultiChatStore.getState().unreadCounts).toEqual({ conv_1: 1, conv_2: 3 })
    })
  })

  describe('clearUnread', () => {
    it('指定した会話の未読カウントをクリアする', () => {
      useMultiChatStore.getState().incrementUnread('conv_1', 5)
      useMultiChatStore.getState().incrementUnread('conv_2', 3)

      useMultiChatStore.getState().clearUnread('conv_1')

      expect(useMultiChatStore.getState().unreadCounts).toEqual({ conv_2: 3 })
    })

    it('存在しない会話のクリアは状態を変更しない', () => {
      const before = useMultiChatStore.getState().unreadCounts
      useMultiChatStore.getState().clearUnread('non-existent')
      expect(useMultiChatStore.getState().unreadCounts).toBe(before)
    })
  })

  describe('setWsStatus', () => {
    it('WebSocket ステータスを設定する', () => {
      useMultiChatStore.getState().setWsStatus('open')
      expect(useMultiChatStore.getState().wsStatus).toBe('open')
    })

    it('各ステータスに遷移できる', () => {
      const statuses = ['disconnected', 'connecting', 'open', 'failed'] as const
      for (const status of statuses) {
        useMultiChatStore.getState().setWsStatus(status)
        expect(useMultiChatStore.getState().wsStatus).toBe(status)
      }
    })
  })

  describe('updateConversationSummary', () => {
    it('指定した会話のサマリーを更新する', () => {
      useMultiChatStore.getState().setConversations(mockConversations)

      useMultiChatStore.getState().updateConversationSummary('conv_1', 'Updated message', 1700200000000)

      const conv = useMultiChatStore.getState().conversations.find((c) => c.conversationId === 'conv_1')!
      expect(conv.lastMessage).toBe('Updated message')
      expect(conv.updatedAt).toBe(1700200000000)
    })

    it('他の会話に影響しない', () => {
      useMultiChatStore.getState().setConversations(mockConversations)

      useMultiChatStore.getState().updateConversationSummary('conv_1', 'Updated', 1700200000000)

      const conv2 = useMultiChatStore.getState().conversations.find((c) => c.conversationId === 'conv_2')!
      expect(conv2.lastMessage).toBe('Hi')
      expect(conv2.updatedAt).toBe(1700100000000)
    })
  })

  describe('reset', () => {
    it('全状態を初期値にリセットする', () => {
      // 各状態を変更
      useMultiChatStore.getState().setFriends(mockFriends)
      useMultiChatStore.getState().setMyFriendCode('CODE')
      useMultiChatStore.getState().setConversations(mockConversations)
      useMultiChatStore.getState().setActiveConversation('conv_1')
      useMultiChatStore.getState().setActiveMessages(mockMessages)
      useMultiChatStore.getState().setSending(true)
      useMultiChatStore.getState().setError('error')
      useMultiChatStore.getState().setLoadingConversations(true)
      useMultiChatStore.getState().setLoadingMessages(true)
      useMultiChatStore.getState().incrementUnread('conv_1', 5)
      useMultiChatStore.getState().setWsStatus('open')

      // リセット
      useMultiChatStore.getState().reset()

      const state = useMultiChatStore.getState()
      expect(state.friends).toEqual([])
      expect(state.myFriendCode).toBeNull()
      expect(state.conversations).toEqual([])
      expect(state.activeConversationId).toBeNull()
      expect(state.activeMessages).toEqual([])
      expect(state.isSending).toBe(false)
      expect(state.error).toBeNull()
      expect(state.isLoadingConversations).toBe(false)
      expect(state.isLoadingMessages).toBe(false)
      expect(state.unreadCounts).toEqual({})
      expect(state.wsStatus).toBe('disconnected')
    })
  })
})
