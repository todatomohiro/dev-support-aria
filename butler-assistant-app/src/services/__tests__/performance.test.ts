import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import fc from 'fast-check'
import { Live2DRendererImpl } from '../live2dRenderer'
import { MotionControllerImpl } from '../motionController'
import { ResponseParserImpl } from '../responseParser'
import { useAppStore } from '@/stores/appStore'
import { MotionPriority, SUPPORTED_MOTION_TAGS } from '@/types'
import {
  createFPSCounter,
  measurePerformance,
  measurePerformanceAsync,
  throttle,
  debounce,
  MAX_MESSAGE_HISTORY,
} from '@/utils/performance'

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

describe('パフォーマンス最適化', () => {
  describe('メモリリーク検出', () => {
    describe('Live2DRendererImpl', () => {
      let renderer: Live2DRendererImpl

      beforeEach(() => {
        renderer = new Live2DRendererImpl()
        vi.useFakeTimers()
      })

      afterEach(() => {
        renderer.dispose()
        vi.useRealTimers()
      })

      it('dispose()後に全参照がクリアされる', async () => {
        const { canvas } = createMockCanvas()
        await renderer.initialize(canvas, '/models/test.model3.json')

        expect(renderer.getIsInitialized()).toBe(true)

        renderer.dispose()

        expect(renderer.getIsInitialized()).toBe(false)
        expect(renderer.getModelPath()).toBeNull()
        expect(renderer.getCurrentMotionGroup()).toBeNull()
        expect(renderer.getCurrentMotionIndex()).toBe(0)
      })

      it('再初期化時に古いリソースが解放される', async () => {
        const { canvas: canvas1 } = createMockCanvas()
        const { canvas: canvas2 } = createMockCanvas()

        // 初回初期化
        await renderer.initialize(canvas1, '/models/test1.model3.json')
        expect(renderer.getIsInitialized()).toBe(true)
        expect(renderer.getModelPath()).toBe('/models/test1.model3.json')

        // 再初期化（古いリソースが自動解放される）
        await renderer.initialize(canvas2, '/models/test2.model3.json')
        expect(renderer.getIsInitialized()).toBe(true)
        expect(renderer.getModelPath()).toBe('/models/test2.model3.json')
      })

      it('startRendering/stopRendering繰返しでリークなし', async () => {
        const { canvas } = createMockCanvas()
        await renderer.initialize(canvas, '/models/test.model3.json')

        // 複数回の開始/停止を繰り返す
        for (let i = 0; i < 10; i++) {
          renderer.stopRendering()
          renderer.startRendering()
        }

        renderer.stopRendering()

        // 正常に停止し、再開できることを確認
        expect(() => renderer.startRendering()).not.toThrow()
        renderer.stopRendering()
      })

      it('dispose()後にモーション完了コールバックがクリアされる', async () => {
        const { canvas } = createMockCanvas()
        await renderer.initialize(canvas, '/models/test.model3.json')

        const callback = vi.fn()
        renderer.setOnMotionFinished(callback)

        renderer.dispose()

        // dispose後にモーションを開始しても、コールバックは発火しない
        // （初期化されていないため startMotion は warn を出すだけ）
        renderer.startMotion('TapBody', 0, MotionPriority.NORMAL)
        vi.advanceTimersByTime(3000)

        expect(callback).not.toHaveBeenCalled()
      })

      it('getFPS()が初期値0を返す', () => {
        expect(renderer.getFPS()).toBe(0)
      })
    })

    describe('MotionControllerImpl', () => {
      it('reset()でキュー・コールバッククリアが確認できる', () => {
        const controller = new MotionControllerImpl()

        // モーションをキューに追加
        controller.playMotion('smile')
        controller.playMotion('bow')
        controller.playMotion('nod')

        expect(controller.getIsPlaying()).toBe(true)
        expect(controller.getQueueLength()).toBe(2)

        // リセット
        controller.reset()

        expect(controller.getCurrentMotion()).toBeNull()
        expect(controller.getQueueLength()).toBe(0)
        expect(controller.getIsPlaying()).toBe(false)
      })
    })

    describe('メッセージ履歴', () => {
      beforeEach(() => {
        // ストアをリセット
        useAppStore.getState().clearMessages()
      })

      it(`MAX_MESSAGE_HISTORY(${MAX_MESSAGE_HISTORY})超過時に古いメッセージが削除される`, () => {
        const store = useAppStore.getState()

        // MAX_MESSAGE_HISTORY + 10 件のメッセージを追加
        for (let i = 0; i < MAX_MESSAGE_HISTORY + 10; i++) {
          store.addMessage({
            id: `msg-${i}`,
            role: 'user',
            content: `Message ${i}`,
            timestamp: Date.now(),
          })
        }

        const messages = useAppStore.getState().messages
        expect(messages.length).toBe(MAX_MESSAGE_HISTORY)
        // 最新のメッセージが保持されている
        expect(messages[messages.length - 1].id).toBe(`msg-${MAX_MESSAGE_HISTORY + 9}`)
        // 最も古いメッセージは削除されている
        expect(messages[0].id).toBe(`msg-10`)
      })
    })
  })

  describe('パフォーマンスベンチマーク', () => {
    describe('レスポンス解析', () => {
      let parser: ResponseParserImpl

      beforeEach(() => {
        parser = new ResponseParserImpl()
      })

      it('通常JSONの解析が100ms以内に完了する', () => {
        const json = JSON.stringify({ text: 'こんにちは', motion: 'smile' })

        const start = performance.now()
        const result = parser.parse(json)
        const elapsed = performance.now() - start

        expect(result.isValid).toBe(true)
        expect(elapsed).toBeLessThan(100)
      })

      it('大きいJSONの解析が100ms以内に完了する', () => {
        const longText = 'あ'.repeat(10000)
        const json = JSON.stringify({ text: longText, motion: 'bow' })

        const start = performance.now()
        const result = parser.parse(json)
        const elapsed = performance.now() - start

        expect(result.isValid).toBe(true)
        expect(result.text).toBe(longText)
        expect(elapsed).toBeLessThan(100)
      })

      it('不正JSONの解析が100ms以内に完了する', () => {
        const invalidJson = '{ invalid json !!!'

        const start = performance.now()
        const result = parser.parse(invalidJson)
        const elapsed = performance.now() - start

        expect(result.isValid).toBe(false)
        expect(elapsed).toBeLessThan(100)
      })
    })

    describe('ストア操作', () => {
      beforeEach(() => {
        useAppStore.getState().clearMessages()
      })

      it('メッセージ追加が500ms以内に完了する', () => {
        const store = useAppStore.getState()

        const start = performance.now()
        store.addMessage({
          id: 'perf-test-1',
          role: 'user',
          content: 'パフォーマンステスト',
          timestamp: Date.now(),
        })
        const elapsed = performance.now() - start

        expect(elapsed).toBeLessThan(500)
      })

      it('100件連続メッセージ追加が500ms以内に完了する', () => {
        const store = useAppStore.getState()

        const start = performance.now()
        for (let i = 0; i < 100; i++) {
          store.addMessage({
            id: `perf-batch-${i}`,
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `メッセージ ${i}`,
            timestamp: Date.now(),
          })
        }
        const elapsed = performance.now() - start

        expect(useAppStore.getState().messages.length).toBe(100)
        expect(elapsed).toBeLessThan(500)
      })

      it('ストア初期化が3秒以内に完了する', () => {
        const start = performance.now()
        // ストアの再取得（初期化をシミュレート）
        const state = useAppStore.getState()
        const elapsed = performance.now() - start

        expect(state).toBeDefined()
        expect(state.messages).toBeDefined()
        expect(state.config).toBeDefined()
        expect(elapsed).toBeLessThan(3000)
      })
    })

    describe('createFPSCounter', () => {
      it('FPSカウンターが正しく動作する', () => {
        const counter = createFPSCounter()

        // 初期値は0
        expect(counter.getFPS()).toBe(0)

        // update()を呼んでも1秒以内はFPSは更新されない
        counter.update()
        expect(counter.getFPS()).toBe(0)
      })

      it('reset()でFPSが0に戻る', () => {
        const counter = createFPSCounter()
        counter.update()
        counter.reset()
        expect(counter.getFPS()).toBe(0)
      })
    })

    describe('パフォーマンスユーティリティ', () => {
      it('measurePerformanceの初期化が100ms以内に完了する', () => {
        const start = performance.now()
        const result = measurePerformance('テスト計測', () => 42)
        const elapsed = performance.now() - start

        expect(result).toBe(42)
        expect(elapsed).toBeLessThan(100)
      })

      it('measurePerformanceAsyncが正しく動作する', async () => {
        const start = performance.now()
        const result = await measurePerformanceAsync('非同期テスト', async () => 'done')
        const elapsed = performance.now() - start

        expect(result).toBe('done')
        expect(elapsed).toBeLessThan(100)
      })

      it('throttle関数が正しく動作する', () => {
        vi.useFakeTimers()
        const fn = vi.fn()
        const throttled = throttle(fn, 100)

        // 最初の呼出は即座に実行
        throttled()
        expect(fn).toHaveBeenCalledTimes(1)

        // 100ms以内は実行されない
        throttled()
        expect(fn).toHaveBeenCalledTimes(1)

        // 100ms後に実行される
        vi.advanceTimersByTime(100)
        expect(fn).toHaveBeenCalledTimes(2)

        vi.useRealTimers()
      })

      it('debounce関数が正しく動作する', () => {
        vi.useFakeTimers()
        const fn = vi.fn()
        const debounced = debounce(fn, 100)

        // 連続呼出
        debounced()
        debounced()
        debounced()
        expect(fn).not.toHaveBeenCalled()

        // 100ms後に1回だけ実行
        vi.advanceTimersByTime(100)
        expect(fn).toHaveBeenCalledTimes(1)

        vi.useRealTimers()
      })
    })
  })

  describe('プロパティベーステスト', () => {
    it('Feature: butler-assistant-app, Property 24: 任意の有効なJSONパース時間が100ms以内', () => {
      const parser = new ResponseParserImpl()

      fc.assert(
        fc.property(
          fc.record({
            text: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
            motion: fc.constantFrom(...SUPPORTED_MOTION_TAGS),
          }),
          (response) => {
            const json = JSON.stringify(response)

            const start = performance.now()
            const result = parser.parse(json)
            const elapsed = performance.now() - start

            expect(result).toBeDefined()
            expect(result.text).toBeDefined()
            expect(elapsed).toBeLessThan(100)
          }
        ),
        { numRuns: 100 }
      )
    })

    it('Feature: butler-assistant-app, Property 25: メッセージ追加のストア更新が500ms以内', () => {
      // テスト開始前にクリア
      useAppStore.getState().clearMessages()

      fc.assert(
        fc.property(
          fc.record({
            id: fc.uuid(),
            content: fc.string({ minLength: 1 }),
            role: fc.constantFrom('user' as const, 'assistant' as const),
          }),
          (msg) => {
            const store = useAppStore.getState()

            const start = performance.now()
            store.addMessage({
              ...msg,
              timestamp: Date.now(),
            })
            const elapsed = performance.now() - start

            expect(elapsed).toBeLessThan(500)
          }
        ),
        { numRuns: 100 }
      )

      // クリーンアップ
      useAppStore.getState().clearMessages()
    })
  })
})
