import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { Live2DRendererImpl } from '../live2dRenderer'
import { MotionPriority } from '@/types'

// WebGLコンテキストのモック
const createMockCanvas = () => {
  const mockGl = {
    clearColor: vi.fn(),
    clear: vi.fn(),
    viewport: vi.fn(),
    COLOR_BUFFER_BIT: 0x00004000,
  }

  const canvas = {
    getContext: vi.fn().mockReturnValue(mockGl),
    width: 800,
    height: 600,
  } as unknown as HTMLCanvasElement

  return { canvas, mockGl }
}

describe('Live2DRenderer', () => {
  let renderer: Live2DRendererImpl

  beforeEach(() => {
    renderer = new Live2DRendererImpl()
    vi.useFakeTimers()
  })

  afterEach(() => {
    renderer.dispose()
    vi.useRealTimers()
  })

  describe('initialize', () => {
    it('正常に初期化できる', async () => {
      const { canvas } = createMockCanvas()

      await renderer.initialize(canvas, '/models/test.model3.json')

      expect(renderer.getIsInitialized()).toBe(true)
    })

    it('WebGLがサポートされていない場合はエラーをスローする', async () => {
      const canvas = {
        getContext: vi.fn().mockReturnValue(null),
      } as unknown as HTMLCanvasElement

      await expect(renderer.initialize(canvas, '/models/test.model3.json')).rejects.toThrow(
        'WebGL is not supported'
      )
    })
  })

  describe('startMotion', () => {
    it('初期化後にモーションを再生できる', async () => {
      const { canvas } = createMockCanvas()
      await renderer.initialize(canvas, '/models/test.model3.json')

      renderer.startMotion('TapBody', 0, MotionPriority.NORMAL)

      expect(renderer.getCurrentMotionGroup()).toBe('TapBody')
      expect(renderer.getCurrentMotionIndex()).toBe(0)
    })

    it('未初期化状態ではモーション再生がスキップされる', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      renderer.startMotion('TapBody', 0, MotionPriority.NORMAL)

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('モーション完了コールバックが呼ばれる', async () => {
      const { canvas } = createMockCanvas()
      await renderer.initialize(canvas, '/models/test.model3.json')

      const callback = vi.fn()
      renderer.setOnMotionFinished(callback)

      renderer.startMotion('TapBody', 0, MotionPriority.NORMAL)

      // モーション完了をシミュレート（2秒後）
      vi.advanceTimersByTime(2000)

      expect(callback).toHaveBeenCalledTimes(1)
    })
  })

  describe('resize', () => {
    it('キャンバスサイズを更新できる', async () => {
      const { canvas, mockGl } = createMockCanvas()
      await renderer.initialize(canvas, '/models/test.model3.json')

      renderer.resize(1024, 768)

      expect(mockGl.viewport).toHaveBeenCalledWith(0, 0, 1024, 768)
    })
  })

  describe('dispose', () => {
    it('リソースを解放できる', async () => {
      const { canvas } = createMockCanvas()
      await renderer.initialize(canvas, '/models/test.model3.json')

      renderer.dispose()

      expect(renderer.getIsInitialized()).toBe(false)
    })
  })

  describe('startRendering / stopRendering', () => {
    it('描画ループを開始・停止できる', async () => {
      const { canvas } = createMockCanvas()
      await renderer.initialize(canvas, '/models/test.model3.json')

      // 初期化時に描画ループが開始されている
      renderer.stopRendering()

      // 再開
      renderer.startRendering()

      // 停止
      renderer.stopRendering()

      // 再度停止してもエラーにならない
      expect(() => renderer.stopRendering()).not.toThrow()
    })
  })
})
