import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useVAD } from '../useVAD'

/**
 * 音声帯域ビンに値を設定するヘルパー
 *
 * sampleRate=48000, fftSize=512 の場合:
 *   binWidth = 48000/512 ≈ 93.75Hz
 *   voiceBand start = floor(100/93.75) = 1
 *   voiceBand end   = ceil(8000/93.75) = 86
 * frequencyBinCount = fftSize/2 = 256
 */
const MOCK_SAMPLE_RATE = 48000
const MOCK_FFT_SIZE = 512
const MOCK_FREQ_BIN_COUNT = MOCK_FFT_SIZE / 2

/** モック AnalyserNode */
function createMockAnalyser(fillValue = 0) {
  return {
    fftSize: MOCK_FFT_SIZE,
    smoothingTimeConstant: 0.5,
    frequencyBinCount: MOCK_FREQ_BIN_COUNT,
    getByteFrequencyData: vi.fn((array: Uint8Array) => {
      // 全ビンを fillValue で埋める
      for (let i = 0; i < MOCK_FREQ_BIN_COUNT; i++) {
        array[i] = fillValue
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
function setupMocks(options?: { fillValue?: number }) {
  const mockStream = createMockStream()
  const mockAnalyser = createMockAnalyser(options?.fillValue ?? 0)
  const mockSource = { connect: vi.fn() }
  const mockClose = vi.fn()

  const mockAudioContext = {
    sampleRate: MOCK_SAMPLE_RATE,
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

  // AudioContext コンストラクタをモック
  // @ts-expect-error AudioContext モック
  window.AudioContext = function MockAudioContext() {
    return mockAudioContext
  }

  return { mockStream, mockAnalyser, mockAudioContext, mockSource, getUserMedia, mockClose }
}

/** キャリブレーション（1500ms）を完了させるヘルパー */
function completeCalibration(rafCallbacks: Array<(ts: number) => void>, baseTime: number) {
  // キャリブレーション期間のフレームを何回か回す
  for (let t = 0; t <= 1600; t += 100) {
    const cb = rafCallbacks[rafCallbacks.length - 1]
    cb(baseTime + t)
  }
}

describe('useVAD', () => {
  let rafCallbacks: Array<(timestamp: number) => void> = []
  let originalRAF: typeof requestAnimationFrame
  let originalCAF: typeof cancelAnimationFrame
  let originalPerformanceNow: typeof performance.now

  beforeEach(() => {
    vi.clearAllMocks()
    rafCallbacks = []

    originalRAF = globalThis.requestAnimationFrame
    originalCAF = globalThis.cancelAnimationFrame
    originalPerformanceNow = performance.now

    // performance.now をモック（キャリブレーション開始時刻の制御）
    let mockNow = 0
    performance.now = vi.fn(() => mockNow++)

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
    performance.now = originalPerformanceNow
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
      const { mockClose, mockStream } = setupMocks()
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

  describe('キャリブレーション', () => {
    it('キャリブレーション中は isSpeaking=false を維持する', async () => {
      const { mockAnalyser } = setupMocks()
      const { result } = renderHook(() => useVAD())

      await act(async () => {
        await result.current.startMonitoring()
      })

      // 高音量データを設定してもキャリブレーション中は検出しない
      mockAnalyser.getByteFrequencyData.mockImplementation((array: Uint8Array) => {
        for (let i = 0; i < MOCK_FREQ_BIN_COUNT; i++) array[i] = 50
      })

      act(() => {
        const cb = rafCallbacks[rafCallbacks.length - 1]
        cb(500) // キャリブレーション中（1500ms 未満）
      })

      expect(result.current.isSpeaking).toBe(false)
    })
  })

  describe('音量検出', () => {
    it('音量がしきい値を超えると isSpeaking=true になる', async () => {
      const { mockAnalyser } = setupMocks()
      const { result } = renderHook(() => useVAD())

      await act(async () => {
        await result.current.startMonitoring()
      })

      // キャリブレーションを完了（無音で）
      act(() => {
        completeCalibration(rafCallbacks, 0)
      })

      // 音量を高く設定（音声帯域全体に）
      mockAnalyser.getByteFrequencyData.mockImplementation((array: Uint8Array) => {
        for (let i = 0; i < MOCK_FREQ_BIN_COUNT; i++) array[i] = 50
      })

      // キャリブレーション後のフレーム
      act(() => {
        const cb = rafCallbacks[rafCallbacks.length - 1]
        cb(2000)
      })

      expect(result.current.isSpeaking).toBe(true)
      expect(result.current.silenceDurationMs).toBe(0)
    })

    it('無音が続くと silenceDurationMs が増加する', async () => {
      const { mockAnalyser } = setupMocks()
      const { result } = renderHook(() => useVAD())

      await act(async () => {
        await result.current.startMonitoring()
      })

      // キャリブレーション完了
      act(() => {
        completeCalibration(rafCallbacks, 0)
      })

      // 無音データ
      mockAnalyser.getByteFrequencyData.mockImplementation((array: Uint8Array) => {
        for (let i = 0; i < MOCK_FREQ_BIN_COUNT; i++) array[i] = 0
      })

      // 2000ms 時点（無音開始）
      act(() => {
        const cb = rafCallbacks[rafCallbacks.length - 1]
        cb(2000)
      })

      // 2500ms 時点（500ms 後）
      act(() => {
        const cb = rafCallbacks[rafCallbacks.length - 1]
        cb(2500)
      })

      expect(result.current.silenceDurationMs).toBe(500)
    })

    it('ヒステリシス: 発話中→無音700ms未満では isSpeaking が維持される', async () => {
      const { mockAnalyser } = setupMocks()
      const { result } = renderHook(() => useVAD())

      await act(async () => {
        await result.current.startMonitoring()
      })

      // キャリブレーション完了
      act(() => {
        completeCalibration(rafCallbacks, 0)
      })

      // まず発話状態にする
      mockAnalyser.getByteFrequencyData.mockImplementation((array: Uint8Array) => {
        for (let i = 0; i < MOCK_FREQ_BIN_COUNT; i++) array[i] = 50
      })
      act(() => {
        const cb = rafCallbacks[rafCallbacks.length - 1]
        cb(2000)
      })
      expect(result.current.isSpeaking).toBe(true)

      // 無音に切り替え
      mockAnalyser.getByteFrequencyData.mockImplementation((array: Uint8Array) => {
        for (let i = 0; i < MOCK_FREQ_BIN_COUNT; i++) array[i] = 0
      })

      // 500ms 後（700ms 未満）
      act(() => {
        const cb = rafCallbacks[rafCallbacks.length - 1]
        cb(2500)
      })

      // まだ speaking のまま
      expect(result.current.isSpeaking).toBe(true)
    })

    it('ヒステリシス: 無音700ms以上で isSpeaking=false に切り替わる', async () => {
      const { mockAnalyser } = setupMocks()
      const { result } = renderHook(() => useVAD())

      await act(async () => {
        await result.current.startMonitoring()
      })

      // キャリブレーション完了
      act(() => {
        completeCalibration(rafCallbacks, 0)
      })

      // 発話状態
      mockAnalyser.getByteFrequencyData.mockImplementation((array: Uint8Array) => {
        for (let i = 0; i < MOCK_FREQ_BIN_COUNT; i++) array[i] = 50
      })
      act(() => {
        const cb = rafCallbacks[rafCallbacks.length - 1]
        cb(2000)
      })

      // 無音に切り替え（silenceStart が記録される）
      mockAnalyser.getByteFrequencyData.mockImplementation((array: Uint8Array) => {
        for (let i = 0; i < MOCK_FREQ_BIN_COUNT; i++) array[i] = 0
      })
      act(() => {
        const cb = rafCallbacks[rafCallbacks.length - 1]
        cb(2100)
      })

      // 無音開始から 700ms 後
      act(() => {
        const cb = rafCallbacks[rafCallbacks.length - 1]
        cb(2800)
      })

      expect(result.current.isSpeaking).toBe(false)
    })

    it('発話再開で silenceDurationMs がリセットされる', async () => {
      const { mockAnalyser } = setupMocks()
      const { result } = renderHook(() => useVAD())

      await act(async () => {
        await result.current.startMonitoring()
      })

      // キャリブレーション完了
      act(() => {
        completeCalibration(rafCallbacks, 0)
      })

      // 無音状態を作る
      mockAnalyser.getByteFrequencyData.mockImplementation((array: Uint8Array) => {
        for (let i = 0; i < MOCK_FREQ_BIN_COUNT; i++) array[i] = 0
      })
      act(() => {
        const cb = rafCallbacks[rafCallbacks.length - 1]
        cb(2000)
      })
      act(() => {
        const cb = rafCallbacks[rafCallbacks.length - 1]
        cb(2500)
      })
      expect(result.current.silenceDurationMs).toBeGreaterThan(0)

      // 発話再開
      mockAnalyser.getByteFrequencyData.mockImplementation((array: Uint8Array) => {
        for (let i = 0; i < MOCK_FREQ_BIN_COUNT; i++) array[i] = 50
      })
      act(() => {
        const cb = rafCallbacks[rafCallbacks.length - 1]
        cb(2600)
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
