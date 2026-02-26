/**
 * パフォーマンス最適化ユーティリティ
 */

/**
 * メッセージ履歴の最大長
 */
export const MAX_MESSAGE_HISTORY = 100

/**
 * バックグラウンド描画の制御フック用
 */
export function createVisibilityHandler(
  onVisible: () => void,
  onHidden: () => void
): { start: () => void; stop: () => void } {
  let isListening = false

  const handleVisibilityChange = () => {
    if (document.hidden) {
      onHidden()
    } else {
      onVisible()
    }
  }

  return {
    start: () => {
      if (!isListening) {
        document.addEventListener('visibilitychange', handleVisibilityChange)
        isListening = true
      }
    },
    stop: () => {
      if (isListening) {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        isListening = false
      }
    },
  }
}

/**
 * デバウンス関数
 */
export function debounce<T extends (...args: Parameters<T>) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      func(...args)
    }, wait)
  }
}

/**
 * スロットル関数
 */
export function throttle<T extends (...args: Parameters<T>) => void>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let lastFunc: ReturnType<typeof setTimeout> | null = null
  let lastRan: number | null = null

  return (...args: Parameters<T>) => {
    if (lastRan === null) {
      func(...args)
      lastRan = Date.now()
    } else {
      if (lastFunc) {
        clearTimeout(lastFunc)
      }
      lastFunc = setTimeout(() => {
        if (Date.now() - (lastRan as number) >= limit) {
          func(...args)
          lastRan = Date.now()
        }
      }, limit - (Date.now() - lastRan))
    }
  }
}

/**
 * パフォーマンス計測
 */
export function measurePerformance<T>(name: string, fn: () => T): T {
  if (import.meta.env.DEV) {
    const start = performance.now()
    const result = fn()
    const end = performance.now()
    console.log(`[Performance] ${name}: ${(end - start).toFixed(2)}ms`)
    return result
  }
  return fn()
}

/**
 * 非同期パフォーマンス計測
 */
export async function measurePerformanceAsync<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  if (import.meta.env.DEV) {
    const start = performance.now()
    const result = await fn()
    const end = performance.now()
    console.log(`[Performance] ${name}: ${(end - start).toFixed(2)}ms`)
    return result
  }
  return fn()
}

/**
 * requestIdleCallback のポリフィル
 */
export const requestIdleCallbackPolyfill =
  typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? window.requestIdleCallback
    : (callback: IdleRequestCallback): number => {
        const start = Date.now()
        return window.setTimeout(() => {
          callback({
            didTimeout: false,
            timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
          })
        }, 1) as unknown as number
      }

/**
 * cancelIdleCallback のポリフィル
 */
export const cancelIdleCallbackPolyfill =
  typeof window !== 'undefined' && 'cancelIdleCallback' in window
    ? window.cancelIdleCallback
    : (id: number): void => {
        clearTimeout(id)
      }

/**
 * 遅延実行（アイドル時に実行）
 */
export function runWhenIdle(callback: () => void, timeout = 2000): number {
  return requestIdleCallbackPolyfill(callback, { timeout })
}

/**
 * FPS計測ユーティリティ
 */
export function createFPSCounter(): {
  update: () => void
  getFPS: () => number
  reset: () => void
} {
  let frames = 0
  let lastTime = performance.now()
  let fps = 0

  return {
    update: () => {
      frames++
      const now = performance.now()
      const delta = now - lastTime
      if (delta >= 1000) {
        fps = Math.round((frames * 1000) / delta)
        frames = 0
        lastTime = now
      }
    },
    getFPS: () => fps,
    reset: () => {
      frames = 0
      lastTime = performance.now()
      fps = 0
    },
  }
}

/**
 * メモリ使用量の取得（可能な場合）
 */
export function getMemoryUsage(): { usedJSHeapSize?: number; totalJSHeapSize?: number } | null {
  if (
    typeof window !== 'undefined' &&
    'performance' in window &&
    'memory' in (performance as Performance & { memory?: MemoryInfo })
  ) {
    const memory = (performance as Performance & { memory: MemoryInfo }).memory
    return {
      usedJSHeapSize: memory.usedJSHeapSize,
      totalJSHeapSize: memory.totalJSHeapSize,
    }
  }
  return null
}

interface MemoryInfo {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
}
