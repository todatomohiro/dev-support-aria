import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { responseParser } from '../responseParser'
import { SUPPORTED_MOTION_TAGS } from '@/types'

describe('ResponseParser', () => {
  describe('parse', () => {
    it('正常なJSONレスポンスを解析できる', () => {
      const json = '{"text": "かしこまりました", "motion": "bow"}'
      const result = responseParser.parse(json)

      expect(result.text).toBe('かしこまりました')
      expect(result.motion).toBe('bow')
      expect(result.isValid).toBe(true)
    })

    it('不正なJSON構文の場合デフォルト値を返す', () => {
      const invalid = 'not a json'
      const result = responseParser.parse(invalid)

      expect(result.isValid).toBe(false)
      expect(result.text).toBeDefined()
      expect(result.motion).toBe('bow')
    })

    it('textフィールドが欠落している場合デフォルト値で補完する', () => {
      const json = '{"motion": "smile"}'
      const result = responseParser.parse(json)

      expect(result.isValid).toBe(false)
      expect(result.text).toBeDefined()
      expect(result.motion).toBe('smile')
    })

    it('motionフィールドが欠落している場合デフォルト値で補完する', () => {
      const json = '{"text": "こんにちは"}'
      const result = responseParser.parse(json)

      expect(result.isValid).toBe(false)
      expect(result.text).toBe('こんにちは')
      expect(result.motion).toBe('bow')
    })

    it('無効なモーションタグはidleに正規化される', () => {
      const json = '{"text": "テスト", "motion": "invalid"}'
      const result = responseParser.parse(json)

      expect(result.motion).toBe('idle')
    })

    it('JSON以外のテキストを含む文字列からJSONを抽出できる', () => {
      const mixed = 'Here is the response: {"text": "抽出テスト", "motion": "nod"} end'
      const result = responseParser.parse(mixed)

      expect(result.text).toBe('抽出テスト')
      expect(result.motion).toBe('nod')
      expect(result.isValid).toBe(true)
    })
  })

  describe('serialize', () => {
    it('ParsedResponseをJSON文字列に変換できる', () => {
      const response = {
        text: 'テスト回答',
        motion: 'smile',
        isValid: true,
      }
      const json = responseParser.serialize(response)
      const parsed = JSON.parse(json)

      expect(parsed.text).toBe('テスト回答')
      expect(parsed.motion).toBe('smile')
    })
  })

  describe('validate', () => {
    it('有効なレスポンスはisValid=trueを返す', () => {
      const response = { text: 'テスト', motion: 'bow' }
      const result = responseParser.validate(response)

      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('nullはバリデーションエラーになる', () => {
      const result = responseParser.validate(null)

      expect(result.isValid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('空文字のtextはバリデーションエラーになる', () => {
      const response = { text: '', motion: 'bow' }
      const result = responseParser.validate(response)

      expect(result.isValid).toBe(false)
      expect(result.errors.some((e) => e.field === 'text')).toBe(true)
    })
  })

  // Property-based tests
  describe('Property Tests', () => {
    // Property 6: JSON解析とオブジェクト変換
    it('Feature: butler-assistant-app, Property 6: 有効なStructuredResponseは正しく解析される', () => {
      fc.assert(
        fc.property(
          fc.record({
            // 空白のみの文字列は無効として扱われるため、filterで除外
            text: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
            motion: fc.constantFrom(...SUPPORTED_MOTION_TAGS),
          }),
          (response) => {
            const json = JSON.stringify(response)
            const parsed = responseParser.parse(json)

            expect(parsed.text).toBe(response.text)
            expect(parsed.motion).toBe(response.motion)
            expect(parsed.isValid).toBe(true)
          }
        ),
        { numRuns: 100 }
      )
    })

    // Property 8: 不正JSON時のデフォルト値返却
    it('Feature: butler-assistant-app, Property 8: 不正な入力でもクラッシュしない', () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          const result = responseParser.parse(input)

          expect(result).toBeDefined()
          expect(typeof result.text).toBe('string')
          expect(typeof result.motion).toBe('string')
        }),
        { numRuns: 100 }
      )
    })

    // Property 17: レスポンスのシリアライズとデシリアライズ（ラウンドトリップ）
    it('Feature: butler-assistant-app, Property 17: シリアライズ→パースのラウンドトリップが成立する', () => {
      fc.assert(
        fc.property(
          fc.record({
            // 空白のみの文字列は無効として扱われるため、filterで除外
            text: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
            motion: fc.constantFrom(...SUPPORTED_MOTION_TAGS),
            isValid: fc.boolean(),
          }),
          (original) => {
            const serialized = responseParser.serialize(original)
            const parsed = responseParser.parse(serialized)

            expect(parsed.text).toBe(original.text)
            expect(parsed.motion).toBe(original.motion)
          }
        ),
        { numRuns: 100 }
      )
    })

    // Property 18: 必須フィールドの検証
    it('Feature: butler-assistant-app, Property 18: 必須フィールド欠落時にバリデーションエラー', () => {
      fc.assert(
        fc.property(fc.object(), (obj) => {
          const result = responseParser.validate(obj)

          // textとmotionが両方存在し有効な場合のみisValid=true
          const hasValidText =
            'text' in obj && typeof obj.text === 'string' && (obj.text as string).trim() !== ''
          const hasValidMotion = 'motion' in obj && typeof obj.motion === 'string'

          if (!hasValidText || !hasValidMotion) {
            expect(result.isValid).toBe(false)
          }
        }),
        { numRuns: 100 }
      )
    })
  })
})
