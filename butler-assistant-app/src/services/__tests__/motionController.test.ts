import { describe, it, expect, beforeEach, vi } from 'vitest'
import fc from 'fast-check'
import { MotionControllerImpl } from '../motionController'
import { SUPPORTED_MOTION_TAGS } from '@/types'

describe('MotionController', () => {
  let controller: MotionControllerImpl

  beforeEach(() => {
    controller = new MotionControllerImpl()
  })

  describe('playMotion', () => {
    it('最初のモーションは即座に再生される', () => {
      controller.playMotion('smile')

      expect(controller.getCurrentMotion()).toBe('smile')
      expect(controller.getIsPlaying()).toBe(true)
    })

    it('再生中に新しいモーションを追加するとキューに入る', () => {
      controller.playMotion('smile')
      controller.playMotion('bow')
      controller.playMotion('nod')

      expect(controller.getCurrentMotion()).toBe('smile')
      expect(controller.getQueueLength()).toBe(2)
    })

    it('無効なモーションタグはidleに正規化される', () => {
      controller.playMotion('invalid')

      expect(controller.getCurrentMotion()).toBe('idle')
    })
  })

  describe('getCurrentMotion', () => {
    it('初期状態ではnullを返す', () => {
      expect(controller.getCurrentMotion()).toBeNull()
    })

    it('モーション再生中は現在のモーションを返す', () => {
      controller.playMotion('think')

      expect(controller.getCurrentMotion()).toBe('think')
    })
  })

  describe('returnToIdle', () => {
    it('待機状態に戻る', () => {
      controller.playMotion('smile')
      controller.returnToIdle()

      expect(controller.getCurrentMotion()).toBe('idle')
      expect(controller.getIsPlaying()).toBe(false)
    })
  })

  describe('playNext', () => {
    it('キューから次のモーションを再生する', () => {
      controller.playMotion('smile')
      controller.playMotion('bow')
      controller.playMotion('nod')

      controller.playNext()

      expect(controller.getCurrentMotion()).toBe('bow')
      expect(controller.getQueueLength()).toBe(1)
    })

    it('キューが空の場合はidleに戻る', () => {
      controller.playMotion('smile')
      controller.playNext()

      expect(controller.getCurrentMotion()).toBe('idle')
      expect(controller.getIsPlaying()).toBe(false)
    })

    it('空のキューで再生を試みてもエラーにならない', () => {
      expect(() => controller.playNext()).not.toThrow()
    })
  })

  describe('onMotionComplete', () => {
    it('完了コールバックが登録される', () => {
      const callback = vi.fn()
      controller.onMotionComplete(callback)
      controller.playMotion('smile')
      controller.returnToIdle()

      expect(callback).toHaveBeenCalledTimes(1)
    })
  })

  describe('reset', () => {
    it('状態がリセットされる', () => {
      controller.playMotion('smile')
      controller.playMotion('bow')
      controller.reset()

      expect(controller.getCurrentMotion()).toBeNull()
      expect(controller.getQueueLength()).toBe(0)
      expect(controller.getIsPlaying()).toBe(false)
    })
  })

  describe('getMotionDefinition', () => {
    it('有効なモーションタグの定義を返す', () => {
      const def = controller.getMotionDefinition('bow')

      expect(def).not.toBeNull()
      expect(def!.group).toBe('TapBody')
    })

    it('無効なモーションタグにはnullを返す', () => {
      const def = controller.getMotionDefinition('invalid')

      expect(def).toBeNull()
    })
  })

  // Property-based tests
  describe('Property Tests', () => {
    // Property 9: モーションタグに対応するモーション再生
    it('Feature: butler-assistant-app, Property 9: 有効なモーションタグは正しく再生される', () => {
      fc.assert(
        fc.property(fc.constantFrom(...SUPPORTED_MOTION_TAGS), (motionTag) => {
          const ctrl = new MotionControllerImpl()
          ctrl.playMotion(motionTag)

          expect(ctrl.getCurrentMotion()).toBe(motionTag)
          expect(ctrl.getIsPlaying()).toBe(true)
        }),
        { numRuns: 100 }
      )
    })

    // Property 10: 無効モーションタグ時のデフォルト動作
    it('Feature: butler-assistant-app, Property 10: 無効なモーションタグはidleに正規化される', () => {
      fc.assert(
        fc.property(
          fc.string().filter((s) => !SUPPORTED_MOTION_TAGS.includes(s.toLowerCase().trim() as (typeof SUPPORTED_MOTION_TAGS)[number])),
          (invalidTag) => {
            const ctrl = new MotionControllerImpl()
            ctrl.playMotion(invalidTag)

            expect(ctrl.getCurrentMotion()).toBe('idle')
          }
        ),
        { numRuns: 100 }
      )
    })

    // Property 11: モーション再生完了後の待機状態復帰
    it('Feature: butler-assistant-app, Property 11: モーション完了後はidleに戻る', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...SUPPORTED_MOTION_TAGS.filter((t) => t !== 'idle')),
          (motionTag) => {
            const ctrl = new MotionControllerImpl()
            ctrl.playMotion(motionTag)
            ctrl.handleMotionFinished()

            expect(ctrl.getCurrentMotion()).toBe('idle')
          }
        ),
        { numRuns: 100 }
      )
    })

    // Property 12: モーション再生中のキュー追加
    it('Feature: butler-assistant-app, Property 12: 再生中に追加されたモーションはキューに入る', () => {
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom(...SUPPORTED_MOTION_TAGS), { minLength: 2, maxLength: 10 }),
          (motions) => {
            const ctrl = new MotionControllerImpl()

            // 最初のモーションを再生
            ctrl.playMotion(motions[0])
            const firstMotion = ctrl.getCurrentMotion()

            // 残りのモーションを追加
            for (let i = 1; i < motions.length; i++) {
              ctrl.playMotion(motions[i])
            }

            // 最初のモーションは変わらない
            expect(ctrl.getCurrentMotion()).toBe(firstMotion)
            // 残りはキューに入る
            expect(ctrl.getQueueLength()).toBe(motions.length - 1)
          }
        ),
        { numRuns: 100 }
      )
    })
  })
})
