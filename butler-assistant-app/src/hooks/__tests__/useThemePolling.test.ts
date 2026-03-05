import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useThemePolling } from '../useThemePolling'

// themeService モック
const mockListMessages = vi.fn()
vi.mock('@/services/themeService', () => ({
  themeService: {
    listMessages: (...args: unknown[]) => mockListMessages(...args),
  },
}))

// themeStore モック
const mockSetActiveMessages = vi.fn()
let mockStoreState = {
  isSending: false,
  activeMessages: [] as Array<{ id: string }>,
  setActiveMessages: mockSetActiveMessages,
}
vi.mock('@/stores/themeStore', () => ({
  useThemeStore: {
    getState: () => mockStoreState,
  },
}))

describe('useThemePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockListMessages.mockReset()
    mockListMessages.mockResolvedValue([])
    mockSetActiveMessages.mockReset()
    mockStoreState = {
      isSending: false,
      activeMessages: [],
      setActiveMessages: mockSetActiveMessages,
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('themeId がある場合にポーリングが開始される', async () => {
    renderHook(() => useThemePolling('theme-1'))

    expect(mockListMessages).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(10_000)
    expect(mockListMessages).toHaveBeenCalledWith('theme-1')
  })

  it('themeId が null の場合はポーリングしない', async () => {
    renderHook(() => useThemePolling(null))

    await vi.advanceTimersByTimeAsync(30_000)
    expect(mockListMessages).not.toHaveBeenCalled()
  })

  it('送信中はポーリングをスキップする', async () => {
    mockStoreState = {
      isSending: true,
      activeMessages: [],
      setActiveMessages: mockSetActiveMessages,
    }

    renderHook(() => useThemePolling('theme-1'))

    await vi.advanceTimersByTimeAsync(10_000)
    expect(mockListMessages).not.toHaveBeenCalled()
  })

  it('サーバーのメッセージが増えた場合にストアを更新する', async () => {
    mockStoreState = {
      isSending: false,
      activeMessages: [{ id: '1' }],
      setActiveMessages: mockSetActiveMessages,
    }
    mockListMessages.mockResolvedValue([{ id: '1' }, { id: '2' }])

    renderHook(() => useThemePolling('theme-1'))

    await vi.advanceTimersByTimeAsync(10_000)
    expect(mockSetActiveMessages).toHaveBeenCalledWith([{ id: '1' }, { id: '2' }])
  })

  it('サーバーのメッセージ数が同じ場合はストアを更新しない', async () => {
    mockStoreState = {
      isSending: false,
      activeMessages: [{ id: '1' }],
      setActiveMessages: mockSetActiveMessages,
    }
    mockListMessages.mockResolvedValue([{ id: '1' }])

    renderHook(() => useThemePolling('theme-1'))

    await vi.advanceTimersByTimeAsync(10_000)
    expect(mockSetActiveMessages).not.toHaveBeenCalled()
  })

  it('アンマウント時にポーリングが停止する', async () => {
    const { unmount } = renderHook(() => useThemePolling('theme-1'))

    unmount()
    mockListMessages.mockReset()

    await vi.advanceTimersByTimeAsync(30_000)
    expect(mockListMessages).not.toHaveBeenCalled()
  })
})
