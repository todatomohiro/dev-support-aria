import { describe, it, expect, beforeEach } from 'vitest'
import { useGroupChatStore } from '../groupChatStore'
import type { GroupSummary, GroupMessage, GroupMember, FriendLink } from '@/types'

describe('groupChatStore', () => {
  beforeEach(() => {
    useGroupChatStore.getState().reset()
  })

  describe('初期状態', () => {
    it('すべてのフィールドが初期値を持つ', () => {
      const state = useGroupChatStore.getState()
      expect(state.friends).toEqual([])
      expect(state.myUserCode).toBeNull()
      expect(state.groups).toEqual([])
      expect(state.activeGroupId).toBeNull()
      expect(state.activeMessages).toEqual([])
      expect(state.activeMembers).toEqual([])
      expect(state.lastPollTimestamp).toBeNull()
      expect(state.isSending).toBe(false)
      expect(state.error).toBeNull()
      expect(state.isLoadingGroups).toBe(false)
      expect(state.isLoadingMessages).toBe(false)
      expect(state.unreadCounts).toEqual({})
      expect(state.wsStatus).toBe('disconnected')
    })
  })

  describe('setFriends', () => {
    it('フレンド一覧を設定する', () => {
      const friends: FriendLink[] = [
        { friendUserId: 'u1', displayName: 'Friend1', linkedAt: 1000 },
      ]
      useGroupChatStore.getState().setFriends(friends)
      expect(useGroupChatStore.getState().friends).toEqual(friends)
    })
  })

  describe('setMyUserCode', () => {
    it('ユーザーコードを設定する', () => {
      useGroupChatStore.getState().setMyUserCode('ABC123')
      expect(useGroupChatStore.getState().myUserCode).toBe('ABC123')
    })

    it('null にリセットできる', () => {
      useGroupChatStore.getState().setMyUserCode('ABC123')
      useGroupChatStore.getState().setMyUserCode(null)
      expect(useGroupChatStore.getState().myUserCode).toBeNull()
    })
  })

  describe('setGroups', () => {
    it('グループ一覧を設定する', () => {
      const groups: GroupSummary[] = [
        { groupId: 'g1', groupName: 'Group1', lastMessage: 'Hello', updatedAt: 1000 },
      ]
      useGroupChatStore.getState().setGroups(groups)
      expect(useGroupChatStore.getState().groups).toEqual(groups)
    })
  })

  describe('setActiveGroup', () => {
    it('アクティブなグループ ID を設定する', () => {
      useGroupChatStore.getState().setActiveGroup('g1')
      expect(useGroupChatStore.getState().activeGroupId).toBe('g1')
    })

    it('null にリセットできる', () => {
      useGroupChatStore.getState().setActiveGroup('g1')
      useGroupChatStore.getState().setActiveGroup(null)
      expect(useGroupChatStore.getState().activeGroupId).toBeNull()
    })
  })

  describe('setActiveMessages / appendMessages', () => {
    const msg1: GroupMessage = { id: 'm1', senderId: 'u1', senderName: 'A', content: 'Hello', timestamp: 1000, type: 'text' }
    const msg2: GroupMessage = { id: 'm2', senderId: 'u2', senderName: 'B', content: 'World', timestamp: 2000, type: 'text' }

    it('メッセージを設定する', () => {
      useGroupChatStore.getState().setActiveMessages([msg1])
      expect(useGroupChatStore.getState().activeMessages).toEqual([msg1])
    })

    it('メッセージを追加する', () => {
      useGroupChatStore.getState().setActiveMessages([msg1])
      useGroupChatStore.getState().appendMessages([msg2])
      expect(useGroupChatStore.getState().activeMessages).toEqual([msg1, msg2])
    })

    it('重複メッセージを追加しない', () => {
      useGroupChatStore.getState().setActiveMessages([msg1])
      useGroupChatStore.getState().appendMessages([msg1, msg2])
      expect(useGroupChatStore.getState().activeMessages).toEqual([msg1, msg2])
    })

    it('すべて重複の場合はステートを変更しない', () => {
      useGroupChatStore.getState().setActiveMessages([msg1])
      const before = useGroupChatStore.getState().activeMessages
      useGroupChatStore.getState().appendMessages([msg1])
      const after = useGroupChatStore.getState().activeMessages
      expect(before).toBe(after) // 参照が同一
    })
  })

  describe('setActiveMembers', () => {
    it('メンバー一覧を設定する', () => {
      const members: GroupMember[] = [{ userId: 'u1', nickname: 'User1' }]
      useGroupChatStore.getState().setActiveMembers(members)
      expect(useGroupChatStore.getState().activeMembers).toEqual(members)
    })
  })

  describe('setLastPollTimestamp', () => {
    it('タイムスタンプを設定する', () => {
      useGroupChatStore.getState().setLastPollTimestamp(1700000000000)
      expect(useGroupChatStore.getState().lastPollTimestamp).toBe(1700000000000)
    })
  })

  describe('setSending', () => {
    it('送信中フラグを設定する', () => {
      useGroupChatStore.getState().setSending(true)
      expect(useGroupChatStore.getState().isSending).toBe(true)
    })
  })

  describe('setError', () => {
    it('エラーを設定する', () => {
      useGroupChatStore.getState().setError('エラー')
      expect(useGroupChatStore.getState().error).toBe('エラー')
    })
  })

  describe('setLoadingGroups / setLoadingMessages', () => {
    it('ローディング状態を設定する', () => {
      useGroupChatStore.getState().setLoadingGroups(true)
      expect(useGroupChatStore.getState().isLoadingGroups).toBe(true)

      useGroupChatStore.getState().setLoadingMessages(true)
      expect(useGroupChatStore.getState().isLoadingMessages).toBe(true)
    })
  })

  describe('incrementUnread / clearUnread', () => {
    it('未読カウントを加算する', () => {
      useGroupChatStore.getState().incrementUnread('g1')
      expect(useGroupChatStore.getState().unreadCounts).toEqual({ g1: 1 })

      useGroupChatStore.getState().incrementUnread('g1')
      expect(useGroupChatStore.getState().unreadCounts).toEqual({ g1: 2 })
    })

    it('指定数を加算する', () => {
      useGroupChatStore.getState().incrementUnread('g1', 5)
      expect(useGroupChatStore.getState().unreadCounts).toEqual({ g1: 5 })
    })

    it('未読カウントをクリアする', () => {
      useGroupChatStore.getState().incrementUnread('g1', 3)
      useGroupChatStore.getState().clearUnread('g1')
      expect(useGroupChatStore.getState().unreadCounts).toEqual({})
    })

    it('未読がないグループの clearUnread はステートを変更しない', () => {
      const before = useGroupChatStore.getState().unreadCounts
      useGroupChatStore.getState().clearUnread('nonexistent')
      const after = useGroupChatStore.getState().unreadCounts
      expect(before).toBe(after)
    })
  })

  describe('setWsStatus', () => {
    it('WebSocket ステータスを設定する', () => {
      useGroupChatStore.getState().setWsStatus('open')
      expect(useGroupChatStore.getState().wsStatus).toBe('open')

      useGroupChatStore.getState().setWsStatus('failed')
      expect(useGroupChatStore.getState().wsStatus).toBe('failed')
    })
  })

  describe('updateGroupSummary', () => {
    it('指定グループのサマリーを更新する', () => {
      useGroupChatStore.getState().setGroups([
        { groupId: 'g1', groupName: 'Group1', lastMessage: 'Old', updatedAt: 1000 },
        { groupId: 'g2', groupName: 'Group2', lastMessage: 'Other', updatedAt: 2000 },
      ])

      useGroupChatStore.getState().updateGroupSummary('g1', 'New message', 3000)

      const groups = useGroupChatStore.getState().groups
      expect(groups[0].lastMessage).toBe('New message')
      expect(groups[0].updatedAt).toBe(3000)
      // 他のグループは変更されない
      expect(groups[1].lastMessage).toBe('Other')
      expect(groups[1].updatedAt).toBe(2000)
    })

    it('存在しないグループ ID の場合は何も変わらない', () => {
      useGroupChatStore.getState().setGroups([
        { groupId: 'g1', groupName: 'Group1', lastMessage: 'Hello', updatedAt: 1000 },
      ])

      useGroupChatStore.getState().updateGroupSummary('nonexistent', 'New', 2000)

      const groups = useGroupChatStore.getState().groups
      expect(groups[0].lastMessage).toBe('Hello')
    })
  })

  describe('reset', () => {
    it('すべての状態を初期値にリセットする', () => {
      // 各フィールドを変更
      useGroupChatStore.getState().setGroups([{ groupId: 'g1', groupName: 'G', lastMessage: '', updatedAt: 0 }])
      useGroupChatStore.getState().setActiveGroup('g1')
      useGroupChatStore.getState().setSending(true)
      useGroupChatStore.getState().setError('err')
      useGroupChatStore.getState().incrementUnread('g1')
      useGroupChatStore.getState().setWsStatus('open')

      useGroupChatStore.getState().reset()

      const state = useGroupChatStore.getState()
      expect(state.groups).toEqual([])
      expect(state.activeGroupId).toBeNull()
      expect(state.isSending).toBe(false)
      expect(state.error).toBeNull()
      expect(state.unreadCounts).toEqual({})
      expect(state.wsStatus).toBe('disconnected')
    })
  })
})
