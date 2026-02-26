import '@testing-library/jest-dom'
import { vi } from 'vitest'

// scrollIntoView のモック（JSDOM には実装されていない）
Element.prototype.scrollIntoView = () => {}

// Live2D Cubism Core のモック
;(globalThis as any).Live2DCubismCore = {
  CubismMoc: {
    create: vi.fn(() => ({
      release: vi.fn(),
    })),
  },
  CubismModel: {
    create: vi.fn(() => ({
      update: vi.fn(),
      release: vi.fn(),
    })),
  },
}

// Live2D (Cubism 2) のモック - pixi-live2d-display が要求する
;(window as any).Live2D = {}

// pixi-live2d-display/cubism4 のモック
vi.mock('pixi-live2d-display/cubism4', () => ({
  Live2DModel: {
    from: vi.fn().mockResolvedValue({
      width: 400,
      height: 600,
      scale: { set: vi.fn() },
      x: 0,
      y: 0,
      anchor: { set: vi.fn() },
      destroy: vi.fn(),
      internalModel: {
        motionManager: {
          startMotion: vi.fn().mockResolvedValue(undefined),
        },
      },
    }),
  },
}))

// PIXI.js のモック
vi.mock('pixi.js', () => ({
  Application: vi.fn().mockImplementation(() => ({
    view: document.createElement('canvas'),
    stage: {
      addChild: vi.fn(),
    },
    start: vi.fn(),
    stop: vi.fn(),
    destroy: vi.fn(),
  })),
}))
