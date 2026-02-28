import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCamera } from '../useCamera'

/** getUserMedia のモックストリーム */
function createMockStream() {
  const track = { stop: vi.fn() }
  return {
    getTracks: () => [track],
    _track: track,
  } as unknown as MediaStream & { _track: { stop: ReturnType<typeof vi.fn> } }
}

/** navigator.mediaDevices.getUserMedia のモック */
function mockGetUserMedia(result: 'success' | DOMException | null = 'success') {
  const mockStream = createMockStream()
  const getUserMedia = result === 'success'
    ? vi.fn().mockResolvedValue(mockStream)
    : result === null
      ? undefined
      : vi.fn().mockRejectedValue(result)

  Object.defineProperty(navigator, 'mediaDevices', {
    value: getUserMedia ? { getUserMedia } : undefined,
    writable: true,
    configurable: true,
  })

  return { getUserMedia, mockStream }
}

describe('useCamera', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // mediaDevices をリセット
    Object.defineProperty(navigator, 'mediaDevices', {
      value: undefined,
      writable: true,
      configurable: true,
    })
  })

  describe('start', () => {
    it('getUserMedia 成功時に status が active に遷移する', async () => {
      mockGetUserMedia('success')

      const { result } = renderHook(() => useCamera())

      expect(result.current.status).toBe('inactive')

      await act(async () => {
        await result.current.start()
      })

      expect(result.current.status).toBe('active')
      expect(result.current.error).toBeNull()
    })

    it('NotAllowedError 時に適切な日本語エラーメッセージを返す', async () => {
      const err = new DOMException('Permission denied', 'NotAllowedError')
      mockGetUserMedia(err)

      const { result } = renderHook(() => useCamera())

      await act(async () => {
        await result.current.start()
      })

      expect(result.current.status).toBe('error')
      expect(result.current.error).toBe('カメラの使用が許可されていません')
    })

    it('NotFoundError 時に適切なエラーメッセージを返す', async () => {
      const err = new DOMException('No camera', 'NotFoundError')
      mockGetUserMedia(err)

      const { result } = renderHook(() => useCamera())

      await act(async () => {
        await result.current.start()
      })

      expect(result.current.status).toBe('error')
      expect(result.current.error).toBe('カメラが見つかりません')
    })

    it('ブラウザ非対応時に適切なエラーメッセージを返す', async () => {
      mockGetUserMedia(null) // mediaDevices = undefined

      const { result } = renderHook(() => useCamera())

      await act(async () => {
        await result.current.start()
      })

      expect(result.current.status).toBe('error')
      expect(result.current.error).toBe('このブラウザはカメラに対応していません')
    })
  })

  describe('stop', () => {
    it('ストリームの track.stop() が呼ばれる', async () => {
      const { mockStream } = mockGetUserMedia('success')

      const { result } = renderHook(() => useCamera())

      await act(async () => {
        await result.current.start()
      })

      act(() => {
        result.current.stop()
      })

      expect(mockStream._track.stop).toHaveBeenCalled()
      expect(result.current.status).toBe('inactive')
    })
  })

  describe('captureFrame', () => {
    it('video.readyState < 2 の場合 null を返す', () => {
      const { result } = renderHook(() => useCamera())

      // videoRef.current は null（カメラ未起動）
      const frame = result.current.captureFrame()
      expect(frame).toBeNull()
    })

    it('正常時に base64 文字列（data: プレフィックスなし）を返す', async () => {
      mockGetUserMedia('success')

      const { result } = renderHook(() => useCamera())

      // video 要素を模擬
      const mockCanvas = document.createElement('canvas')
      const mockCtx = {
        drawImage: vi.fn(),
      }
      vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as any)
      vi.spyOn(mockCanvas, 'getContext').mockReturnValue(mockCtx as any)
      vi.spyOn(mockCanvas, 'toDataURL').mockReturnValue('data:image/jpeg;base64,dGVzdGRhdGE=')

      // videoRef に模擬要素を設定
      const video = document.createElement('video')
      Object.defineProperty(video, 'readyState', { value: 4, writable: true })
      Object.defineProperty(video, 'videoWidth', { value: 640, writable: true })
      Object.defineProperty(video, 'videoHeight', { value: 480, writable: true })

      // videoRef を直接設定
      ;(result.current.videoRef as any).current = video

      const frame = result.current.captureFrame()
      expect(frame).toBe('dGVzdGRhdGE=')
      expect(frame).not.toContain('data:')

      vi.restoreAllMocks()
    })

    it('MAX_CAPTURE_WIDTH でリサイズされる', async () => {
      mockGetUserMedia('success')

      const { result } = renderHook(() => useCamera())

      const mockCanvas = document.createElement('canvas')
      const mockCtx = {
        drawImage: vi.fn(),
      }
      vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as any)
      vi.spyOn(mockCanvas, 'getContext').mockReturnValue(mockCtx as any)
      vi.spyOn(mockCanvas, 'toDataURL').mockReturnValue('data:image/jpeg;base64,dGVzdA==')

      // 大きい映像を模擬（1280x960 → MAX_CAPTURE_WIDTH=512 でリサイズ）
      const video = document.createElement('video')
      Object.defineProperty(video, 'readyState', { value: 4 })
      Object.defineProperty(video, 'videoWidth', { value: 1280 })
      Object.defineProperty(video, 'videoHeight', { value: 960 })

      ;(result.current.videoRef as any).current = video

      result.current.captureFrame()

      // scale = 512 / 1280 = 0.4 → width=512, height=384
      expect(mockCanvas.width).toBe(512)
      expect(mockCanvas.height).toBe(384)

      vi.restoreAllMocks()
    })
  })

  describe('クリーンアップ', () => {
    it('アンマウント時にストリームのトラックが停止される', async () => {
      const { mockStream } = mockGetUserMedia('success')

      const { result, unmount } = renderHook(() => useCamera())

      await act(async () => {
        await result.current.start()
      })

      unmount()

      expect(mockStream._track.stop).toHaveBeenCalled()
    })
  })
})
