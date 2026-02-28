import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useWebSocket } from '../useWebSocket'

// wsService をモック
const mockConnect = vi.fn()
const mockDisconnect = vi.fn()
const mockSubscribe = vi.fn()
const mockUnsubscribe = vi.fn()

vi.mock('@/services/wsService', () => ({
  wsService: {
    connect: (...args: unknown[]) => mockConnect(...args),
    disconnect: (...args: unknown[]) => mockDisconnect(...args),
    subscribe: (...args: unknown[]) => mockSubscribe(...args),
    unsubscribe: (...args: unknown[]) => mockUnsubscribe(...args),
  },
}))

// authStore をモック
vi.mock('@/auth/authStore', () => ({
  useAuthStore: vi.fn((selector: (state: Record<string, unknown>) => unknown) =>
    selector({ accessToken: 'test-token' })
  ),
}))

describe('useWebSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('マウント時に connect が呼ばれ、アンマウント時に disconnect が呼ばれる', () => {
    const { unmount } = renderHook(() => useWebSocket(null))

    expect(mockConnect).toHaveBeenCalledWith('test-token')

    unmount()
    expect(mockDisconnect).toHaveBeenCalled()
  })

  it('conversationId 指定時に subscribe が呼ばれる', () => {
    renderHook(() => useWebSocket('conv_1'))

    expect(mockSubscribe).toHaveBeenCalledWith('conv_1')
  })

  it('conversationId が null の場合は subscribe されない', () => {
    renderHook(() => useWebSocket(null))

    expect(mockSubscribe).not.toHaveBeenCalled()
  })

  it('conversationId 変更時に前の会話を unsubscribe して新しい会話を subscribe する', () => {
    const { rerender } = renderHook(
      ({ id }) => useWebSocket(id),
      { initialProps: { id: 'conv_1' as string | null } }
    )

    expect(mockSubscribe).toHaveBeenCalledWith('conv_1')

    rerender({ id: 'conv_2' })

    expect(mockUnsubscribe).toHaveBeenCalledWith('conv_1')
    expect(mockSubscribe).toHaveBeenCalledWith('conv_2')
  })
})
