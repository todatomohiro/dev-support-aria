import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { createRef } from 'react'
import { Live2DCanvas } from '../Live2DCanvas'
import type { Live2DCanvasHandle } from '../Live2DCanvas'

// ResizeObserver モック（new で呼ばれるため function コンストラクタを使用）
const mockResizeObserverDisconnect = vi.fn()
const mockResizeObserverObserve = vi.fn()

function MockResizeObserver(this: any) {
  this.observe = mockResizeObserverObserve
  this.unobserve = vi.fn()
  this.disconnect = mockResizeObserverDisconnect
}
vi.stubGlobal('ResizeObserver', MockResizeObserver)

// Live2DModel.from のモック参照を取得
const mockStartMotion = vi.fn().mockResolvedValue(undefined)
const mockModelDestroy = vi.fn()
const mockModelInstance = {
  width: 400,
  height: 600,
  scale: { set: vi.fn() },
  x: 0,
  y: 0,
  anchor: { set: vi.fn() },
  destroy: mockModelDestroy,
  internalModel: {
    motionManager: {
      startMotion: mockStartMotion,
    },
  },
}

// pixi-live2d-display/cubism4 のモックを上書き
const mockFrom = vi.fn().mockResolvedValue(mockModelInstance)
vi.mock('pixi-live2d-display/cubism4', () => ({
  Live2DModel: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}))

// PIXI.Application のモック参照
const mockAppDestroy = vi.fn()
const mockAddChild = vi.fn()
const mockAppStart = vi.fn()
const mockAppStop = vi.fn()
const mockTickerAdd = vi.fn()

vi.mock('pixi.js', () => {
  // new で呼ばれるため function コンストラクタを使用
  function MockApplication(this: any) {
    this.view = document.createElement('canvas')
    this.stage = { addChild: mockAddChild, destroyed: false }
    this.start = mockAppStart
    this.stop = mockAppStop
    this.destroy = mockAppDestroy
    this.ticker = { add: mockTickerAdd }
  }
  return { Application: MockApplication }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Live2DCanvas', () => {
  describe('マウント/アンマウント', () => {
    it('コンポーネントがマウントされキャンバスコンテナが表示される', () => {
      render(
        <Live2DCanvas
          modelPath="default"
          currentMotion={null}
        />
      )

      expect(screen.getByTestId('live2d-canvas')).toBeInTheDocument()
    })

    it('モデルパスが "default" の場合プレースホルダーが表示される', async () => {
      render(
        <Live2DCanvas
          modelPath="default"
          currentMotion={null}
        />
      )

      // 初期化完了を待つ
      await act(() => Promise.resolve())

      expect(screen.getByTestId('live2d-placeholder')).toBeInTheDocument()
      expect(screen.getByText('Live2Dモデル未設定')).toBeInTheDocument()
    })

    it('有効なモデルパスの場合モデルが読み込まれる', async () => {
      render(
        <Live2DCanvas
          modelPath="/models/test.model3.json"
          currentMotion={null}
        />
      )

      await act(() => Promise.resolve())

      expect(mockFrom).toHaveBeenCalledWith('/models/test.model3.json', {
        autoInteract: false,
        autoUpdate: true,
      })
      expect(mockAddChild).toHaveBeenCalledWith(mockModelInstance)
    })

    it('モデル読み込み失敗時にエラーメッセージが表示される', async () => {
      mockFrom.mockRejectedValueOnce(new Error('Load failed'))

      render(
        <Live2DCanvas
          modelPath="/models/invalid.model3.json"
          currentMotion={null}
        />
      )

      await act(() => Promise.resolve())

      expect(screen.getByText('モデルの読み込みに失敗しました')).toBeInTheDocument()
    })

    it('アンマウント時にリソースが解放される', async () => {
      const { unmount } = render(
        <Live2DCanvas
          modelPath="/models/test.model3.json"
          currentMotion={null}
        />
      )

      await act(() => Promise.resolve())

      unmount()

      expect(mockModelDestroy).toHaveBeenCalled()
      expect(mockAppDestroy).toHaveBeenCalledWith(true, {
        children: true,
        texture: true,
        baseTexture: true,
      })
    })

    it('モデルなしでアンマウントしてもエラーが発生しない', async () => {
      const { unmount } = render(
        <Live2DCanvas
          modelPath="default"
          currentMotion={null}
        />
      )

      await act(() => Promise.resolve())

      expect(() => unmount()).not.toThrow()
    })
  })

  describe('モーション再生', () => {
    it('currentMotion 変更時にモーションが再生される', async () => {
      const { rerender } = render(
        <Live2DCanvas
          modelPath="/models/test.model3.json"
          currentMotion={null}
        />
      )

      await act(() => Promise.resolve())

      rerender(
        <Live2DCanvas
          modelPath="/models/test.model3.json"
          currentMotion="idle"
        />
      )

      await act(() => Promise.resolve())

      expect(mockStartMotion).toHaveBeenCalledWith('Idle', 0)
    })

    it('定義済みモーションがマッピングに従って再生される', async () => {
      const { rerender } = render(
        <Live2DCanvas
          modelPath="/models/test.model3.json"
          currentMotion={null}
        />
      )

      await act(() => Promise.resolve())

      // happy モーション（group: '', index: 0）
      rerender(
        <Live2DCanvas
          modelPath="/models/test.model3.json"
          currentMotion="happy"
        />
      )

      await act(() => Promise.resolve())

      expect(mockStartMotion).toHaveBeenCalledWith('', 0)
    })

    it('未定義モーションはデフォルト(Idle)にフォールバックする', async () => {
      const { rerender } = render(
        <Live2DCanvas
          modelPath="/models/test.model3.json"
          currentMotion={null}
        />
      )

      await act(() => Promise.resolve())

      rerender(
        <Live2DCanvas
          modelPath="/models/test.model3.json"
          currentMotion="unknown_motion"
        />
      )

      await act(() => Promise.resolve())

      expect(mockStartMotion).toHaveBeenCalledWith('Idle', 0)
    })

    it('モーション完了時にコールバックが呼ばれる', async () => {
      const onMotionComplete = vi.fn()
      mockStartMotion.mockReturnValueOnce(Promise.resolve())

      const { rerender } = render(
        <Live2DCanvas
          modelPath="/models/test.model3.json"
          currentMotion={null}
          onMotionComplete={onMotionComplete}
        />
      )

      await act(() => Promise.resolve())

      rerender(
        <Live2DCanvas
          modelPath="/models/test.model3.json"
          currentMotion="idle"
          onMotionComplete={onMotionComplete}
        />
      )

      await act(() => Promise.resolve())

      expect(onMotionComplete).toHaveBeenCalled()
    })

    it('ref 経由で playMotion が呼べる', async () => {
      const ref = createRef<Live2DCanvasHandle>()

      render(
        <Live2DCanvas
          ref={ref}
          modelPath="/models/test.model3.json"
          currentMotion={null}
        />
      )

      await act(() => Promise.resolve())

      act(() => {
        ref.current?.playMotion('TestGroup', 2)
      })

      expect(mockStartMotion).toHaveBeenCalledWith('TestGroup', 2)
    })

    it('ref 経由で playExpression が呼べる', async () => {
      const mockExpression = vi.fn()
      ;(mockModelInstance as any).expression = mockExpression

      const ref = createRef<Live2DCanvasHandle>()

      render(
        <Live2DCanvas
          ref={ref}
          modelPath="/models/test.model3.json"
          currentMotion={null}
        />
      )

      await act(() => Promise.resolve())

      act(() => {
        ref.current?.playExpression('happy')
      })

      expect(mockExpression).toHaveBeenCalledWith('happy')
    })
  })

  describe('リサイズ対応', () => {
    it('ResizeObserver がコンテナに設定される', async () => {
      render(
        <Live2DCanvas
          modelPath="default"
          currentMotion={null}
        />
      )

      await act(() => Promise.resolve())

      expect(mockResizeObserverObserve).toHaveBeenCalled()
    })

    it('アンマウント時に ResizeObserver が解除される', async () => {
      const { unmount } = render(
        <Live2DCanvas
          modelPath="default"
          currentMotion={null}
        />
      )

      await act(() => Promise.resolve())

      unmount()

      expect(mockResizeObserverDisconnect).toHaveBeenCalled()
    })

    it('className プロパティが適用される', () => {
      render(
        <Live2DCanvas
          modelPath="default"
          currentMotion={null}
          className="custom-class"
        />
      )

      const container = screen.getByTestId('live2d-canvas').parentElement
      expect(container?.className).toContain('custom-class')
    })
  })

  describe('バックグラウンド制御', () => {
    it('visibilitychange イベントリスナーが登録される', async () => {
      const addEventListenerSpy = vi.spyOn(document, 'addEventListener')

      render(
        <Live2DCanvas
          modelPath="default"
          currentMotion={null}
        />
      )

      await act(() => Promise.resolve())

      const visibilityCall = addEventListenerSpy.mock.calls.find(
        ([event]) => event === 'visibilitychange'
      )
      expect(visibilityCall).toBeDefined()

      addEventListenerSpy.mockRestore()
    })
  })
})
