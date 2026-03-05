import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useVAD } from '../useVAD'

/** モック AnalyserNode */
function createMockAnalyser(volumeData: number[] = [0]) {
  return {
    fftSize: 256,
    smoothingTimeConstant: 0.5,
    frequencyBinCount: volumeData.length,
    getByteFrequencyData: vi.fn((array: Uint8Array) => {
      for (let i = 0; i < volumeData.length; i++) {
        array[i] = volumeData[i]
      }
    }),
  }
}

/** モック MediaStream */
function createMockStream() {
  const track = { stop: vi.fn() }
  return {
    getTracks: () => [track],
    _track: track,
  } as unknown as MediaStream & { _track: { stop: ReturnType<typeof vi.fn> } }
}

/** テスト用のモック構築 */
function setupMocks(options?: { analyserData?: number[] }) {
  const mockStream = createMockStream()
  const mockAnalyser = createMockAnalyser(options?.analyserData ?? [0])
  const mockSource = { connect: vi.fn() }
  const mockClose = vi.fn()

  const mockAudioContext = {
    createMediaStreamSource: vi.fn().mockReturnValue(mockSource),
    createAnalyser: vi.fn().mockReturnValue(mockAnalyser),
    close: mockClose,
  }

  const getUserMedia = vi.fn().mockResolvedValue(mockStream)
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    writable: true,
    configurable: true,
  })

  // AudioContext コンストラクタをモック（class 構文で定義して new 可能にする）
  // @ts-expect-error AudioContext モック
  window.AudioContext = function MockAudioContext() {
    return mockAudioContext
  }

  return { mockStream, mockAnalyser, mockAudioContext, mockSource, getUserMedia, mockClose }
}

describe('useVAD', () => {
  let rafCallbacks: Array<(timestamp: number) => void> = []
  let originalRAF: typeof requestAnimationFrame
  let originalCAF: typeof cancelAnimationFrame

  beforeEach(() => {
    vi.clearAllMocks()
    rafCallbacks = []

    originalRAF = globalThis.requestAnimationFrame
    originalCAF = globalThis.cancelAnimationFrame

    let rafId = 0
    globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb as (timestamp: number) => void)
      return ++rafId
    })
    globalThis.cancelAnimationFrame = vi.fn()
  })

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRAF
    globalThis.cancelAnimationFrame = originalCAF
    Object.defineProperty(navigator, 'mediaDevices', {
      value: undefined,
      writable: true,
      configurable: true,
    })
    // @ts-expect-error AudioContext クリーンアップ
    delete window.AudioContext
  })

  describe('isSupported', () => {
    it('AudioContext と getUserMedia が存在する場合 true', () => {
      setupMocks()
      const { result } = renderHook(() => useVAD())
      expect(result.current.isSupported).toBe(true)
    })

    it('AudioContext が存在しない場合 false', () => {
      // getUserMedia のみ設定、AudioContext は設定しない
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn() },
        writable: true,
        configurable: true,
      })
      // @ts-expect-error AudioContext クリーンアップ
      delete window.AudioContext
      const { result } = renderHook(() => useVAD())
      expect(result.current.isSupported).toBe(false)
    })
  })

  describe('startMonitoring', () => {
    it('getUserMedia を呼び出してマイクストリームを取得する', async () => {
      const { getUserMedia } = setupMocks()
      const { result } = renderHook(() => useVAD())

      await act(async () => {
        await result.current.startMonitoring()
      })

      expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    })

    it('AudioContext と AnalyserNode を作成する', async () => {
      const { mockAudioContext, mockSource } = setupMocks()
      const { result } = renderHook(() => useVAD())

      await act(async () => {
        await result.current.startMonitoring()
      })

      expect(mockAudioContext.createMediaStreamSource).toHaveBeenCalled()
      expect(mockAudioContext.createAnalyser).toHaveBeenCalled()
      expect(mockSource.connect).toHaveBeenCalled()
    })

    it('requestAnimationFrame でループを開始する', async () => {
      setupMocks()
      const { result } = renderHook(() => useVAD())

      await act(async () => {
        await result.current.startMonitoring()
      })

      expect(globalThis.requestAnimationFrame).toHaveBeenCalled()
    })

    it('初期状態は isSpeaking=false, silenceDurationMs=0', async () => {
      setupMocks()
      const { result } = renderHook(() => useVAD())

      await act(async () => {
        await result.current.startMonitoring()
      })

      expect(result.current.isSpeaking).toBe(false)
      expect(result.current.silenceDurationMs).toBe(0)
    })
  })

  describe('stopMonitoring', () => {
    it('AudioContext を close し、ストリームトラックを停止する', async () => {
      const { mockStream, mockClose } = setupMocks()
      const { result } = renderHook(() => useVAD())

      await act(async () => {
        await result.current.startMonitoring()
      })
      act(() => {
        result.current.stopMonitoring()
      })

      expect(mockClose).toHaveBeenCalled()
      expect(mockStream._track.stop).toHaveBeenCalled()
    })

    it('停止後は isSpeaking=false, silenceDurationMs=0 にリセットされる', async () => {
      setupMocks()
      const { result } = renderHook(() => useVAD())

      await act(async () => {
        await result.current.startMonitoring()
      })
      act(() => {
        result.current.stopMonitoring()
      })

      expect(result.current.isSpeaking).toBe(false)
      expect(result.current.silenceDurationMs).toBe(0)
    })
  })

  describe('音量検出', () => {
    it('音量がしきい値を超えると isSpeaking=true になる', async () => {
      const { mockAnalyser } = setupMocks({ analyserData: [0] })
      const { result } = renderHook(() => useVAD())

      await act(async () => {
        await result.current.startMonitoring()
      })

      // 音量を高く設定
      mockAnalyser.getByteFrequencyData.mockImplementation((array: Uint8Array) => {
        array[0] = 50 // しきい値(15)超え
      })

      // rAF コールバックを実行
      act(() => {
        const cb = rafCallbacks[rafCallbacks.length - 1]
        cb(1000)
      })

      expect(result.current.isSpeaking).toBe(true)
      expect(result.current.silenceDurationMs).toBe(0)
    })

    it('無音が続くと silenceDurationMs が増加する', async () => {
      const { mockAnalyser } = setupMocks({ analyserData: [0] })
      const { result } = renderHook(() => useVAD())

      await act(async () => {
        await result.current.startMonitoring()
      })

      // 無音データ
      mockAnalyser.getByteFrequencyData.mockImplementation((array: Uint8Array) => {
        array[0] = 0
      })

      // 0ms 時点
      act(() => {
        const cb = rafCallbacks[rafCallbacks.length - 1]
        cb(1000)
      })

      // 500ms 後
      act(() => {
        const cb = rafCallbacks[rafCallbacks.length - 1]
        cb(1500)
      })

      expect(result.current.silenceDurationMs).toBe(500)
    })

    it('ヒステリシス: 発話中→無音300ms未満では isSpeaking が維持される', async () => {
      const { mockAnalyser } = setupMocks({ analyserData: [0] })
      const { result } = renderHook(() => useVAD())

      await act(async () => {
        await result.current.startMonitoring()
      })

      // まず発話状態にする
      mockAnalyser.getByteFrequencyData.mockImplementation((array: Uint8Array) => {
        array[0] = 50
      })
      act(() => {
        const cb = rafCallbacks[rafCallbacks.length - 1]
        cb(1000)
      })
      expect(result.current.isSpeaking).toBe(true)

      // 無音に切り替え
      mockAnalyser.getByteFrequencyData.mockImplementation((array: Uint8Array) => {
        array[0] = 0
      })

      // 200ms 後（300ms 未満）
      act(() => {
        const cb = rafCallbacks[rafCallbacks.length - 1]
        cb(1200)
      })

      // まだ speaking のまま
      expect(result.current.isSpeaking).toBe(true)
    })

    it('ヒステリシス: 無音300ms以上で isSpeaking=false に切り替わる', async () => {
      const { mockAnalyser } = setupMocks({ analyserData: [0] })
      const { result } = renderHook(() => useVAD())

      await act(async () => {
        await result.current.startMonitoring()
      })

      // 発話状態
      mockAnalyser.getByteFrequencyData.mockImplementation((array: Uint8Array) => {
        array[0] = 50
      })
      act(() => {
        const cb = rafCallbacks[rafCallbacks.length - 1]
        cb(1000)
      })

      // 無音に切り替え（silenceStart が記録される）
      mockAnalyser.getByteFrequencyData.mockImplementation((array: Uint8Array) => {
        array[0] = 0
      })
      act(() => {
        const cb = rafCallbacks[rafCallbacks.length - 1]
        cb(1100)
      })

      // 無音開始から 300ms 後
      act(() => {
        const cb = rafCallbacks[rafCallbacks.length - 1]
        cb(1400)
      })

      expect(result.current.isSpeaking).toBe(false)
    })

    it('発話再開で silenceDurationMs がリセットされる', async () => {
      const { mockAnalyser } = setupMocks({ analyserData: [0] })
      const { result } = renderHook(() => useVAD())

      await act(async () => {
        await result.current.startMonitoring()
      })

      // 無音状態を作る
      mockAnalyser.getByteFrequencyData.mockImplementation((array: Uint8Array) => {
        array[0] = 0
      })
      act(() => {
        const cb = rafCallbacks[rafCallbacks.length - 1]
        cb(1000)
      })
      act(() => {
        const cb = rafCallbacks[rafCallbacks.length - 1]
        cb(1500)
      })
      expect(result.current.silenceDurationMs).toBeGreaterThan(0)

      // 発話再開
      mockAnalyser.getByteFrequencyData.mockImplementation((array: Uint8Array) => {
        array[0] = 50
      })
      act(() => {
        const cb = rafCallbacks[rafCallbacks.length - 1]
        cb(1600)
      })

      expect(result.current.silenceDurationMs).toBe(0)
      expect(result.current.isSpeaking).toBe(true)
    })
  })

  describe('アンマウント', () => {
    it('アンマウント時にリソースがクリーンアップされる', async () => {
      const { mockClose, mockStream } = setupMocks()
      const { result, unmount } = renderHook(() => useVAD())

      await act(async () => {
        await result.current.startMonitoring()
      })

      unmount()

      expect(mockClose).toHaveBeenCalled()
      expect(mockStream._track.stop).toHaveBeenCalled()
      expect(globalThis.cancelAnimationFrame).toHaveBeenCalled()
    })
  })
})
