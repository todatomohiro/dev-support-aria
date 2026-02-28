import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGroupPolling } from '../useGroupPolling'
import { useGroupChatStore } from '@/stores/groupChatStore'

// groupService をモック
const mockPollNewMessages = vi.fn()
vi.mock('@/services/groupService', () => ({
  groupService: {
    pollNewMessages: (...args: unknown[]) => mockPollNewMessages(...args),
  },
}))

describe('useGroupPolling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    useGroupChatStore.getState().reset()
    mockPollNewMessages.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('groupId が null の場合はポーリングしない', () => {
    renderHook(() => useGroupPolling(null))

    vi.advanceTimersByTime(10000)

    expect(mockPollNewMessages).not.toHaveBeenCalled()
  })

  it('lastPollTimestamp が null の場合はポーリングしない', () => {
    renderHook(() => useGroupPolling('g1'))

    vi.advanceTimersByTime(10000)

    expect(mockPollNewMessages).not.toHaveBeenCalled()
  })

  it('7秒間隔でポーリングする', async () => {
    useGroupChatStore.getState().setLastPollTimestamp(1700000000000)

    renderHook(() => useGroupPolling('g1'))

    // 最初の7秒後にポーリング
    await vi.advanceTimersByTimeAsync(7000)
    expect(mockPollNewMessages).toHaveBeenCalledWith('g1', 1700000000000)

    // さらに7秒後にもう一度
    await vi.advanceTimersByTimeAsync(7000)
    expect(mockPollNewMessages).toHaveBeenCalledTimes(2)
  })

  it('新着メッセージを受信するとストアに追加する', async () => {
    useGroupChatStore.getState().setLastPollTimestamp(1700000000000)
    useGroupChatStore.getState().setActiveMessages([])

    const newMessages = [
      { id: 'm1', senderId: 'u1', senderName: 'User', content: 'New', timestamp: 1700000001000, type: 'text' as const },
    ]
    mockPollNewMessages.mockResolvedValue(newMessages)

    renderHook(() => useGroupPolling('g1'))

    await vi.advanceTimersByTimeAsync(7000)

    expect(useGroupChatStore.getState().activeMessages).toEqual(newMessages)
    expect(useGroupChatStore.getState().lastPollTimestamp).toBe(1700000001000)
  })

  it('アンマウント時にポーリングを停止する', async () => {
    useGroupChatStore.getState().setLastPollTimestamp(1700000000000)

    const { unmount } = renderHook(() => useGroupPolling('g1'))

    unmount()

    await vi.advanceTimersByTimeAsync(10000)
    expect(mockPollNewMessages).not.toHaveBeenCalled()
  })

  it('groupId が変わるとポーリングをリセットする', async () => {
    useGroupChatStore.getState().setLastPollTimestamp(1700000000000)

    const { rerender } = renderHook(
      ({ id }) => useGroupPolling(id),
      { initialProps: { id: 'g1' as string | null } }
    )

    await vi.advanceTimersByTimeAsync(7000)
    expect(mockPollNewMessages).toHaveBeenCalledWith('g1', 1700000000000)

    rerender({ id: 'g2' })

    await vi.advanceTimersByTimeAsync(7000)
    expect(mockPollNewMessages).toHaveBeenCalledWith('g2', 1700000000000)
  })
})
