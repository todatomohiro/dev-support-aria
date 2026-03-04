import { describe, it, expect } from 'vitest'
import { SentimentServiceImpl } from '../sentimentService'

describe('SentimentService', () => {
  const service = new SentimentServiceImpl()

  describe('analyzeSentiment', () => {
    it('空文字列は neutral を返す', () => {
      const result = service.analyzeSentiment('')
      expect(result.emotion).toBe('neutral')
      expect(result.expression).toBe('exp_01')
      expect(result.score).toBe(0)
    })

    it('空白のみは neutral を返す', () => {
      const result = service.analyzeSentiment('   ')
      expect(result.emotion).toBe('neutral')
      expect(result.expression).toBe('exp_01')
      expect(result.score).toBe(0)
    })

    it('キーワードなしのテキストは neutral を返す', () => {
      const result = service.analyzeSentiment('今日は晴れています')
      expect(result.emotion).toBe('neutral')
      expect(result.expression).toBe('exp_01')
      expect(result.score).toBe(0)
    })

    it('happy キーワードで happy を返す', () => {
      const result = service.analyzeSentiment('ありがとう！すごく助かったよ')
      expect(result.emotion).toBe('happy')
      expect(result.expression).toBe('exp_02')
      expect(result.score).toBeGreaterThan(0)
    })

    it('sad キーワードで sad を返す', () => {
      const result = service.analyzeSentiment('今日は本当に疲れた…もう無理')
      expect(result.emotion).toBe('sad')
      expect(result.expression).toBe('exp_05')
      expect(result.score).toBeGreaterThan(0)
    })

    it('surprised キーワードで surprised を返す', () => {
      const result = service.analyzeSentiment('えっ、マジで！？信じられない！')
      expect(result.emotion).toBe('surprised')
      expect(result.expression).toBe('exp_04')
      expect(result.score).toBeGreaterThan(0)
    })

    it('angry キーワードで angry を返す', () => {
      const result = service.analyzeSentiment('もうむかつく、ありえないんだけど')
      expect(result.emotion).toBe('angry')
      expect(result.expression).toBe('exp_08')
      expect(result.score).toBeGreaterThan(0)
    })

    it('troubled キーワードで troubled を返す', () => {
      const result = service.analyzeSentiment('困ったなぁ、どうすればいいか分からない')
      expect(result.emotion).toBe('troubled')
      expect(result.expression).toBe('exp_07')
      expect(result.score).toBeGreaterThan(0)
    })

    it('embarrassed キーワードで embarrassed を返す', () => {
      const result = service.analyzeSentiment('きゃー恥ずかしい、ドキドキする')
      expect(result.emotion).toBe('embarrassed')
      expect(result.expression).toBe('exp_06')
      expect(result.score).toBeGreaterThan(0)
    })

    it('thinking キーワードで thinking を返す', () => {
      const result = service.analyzeSentiment('これってどうやって使うの？教えて')
      expect(result.emotion).toBe('thinking')
      expect(result.expression).toBe('exp_03')
      expect(result.score).toBeGreaterThan(0)
    })

    it('複数感情マッチ時にスコアが高い方が選択される', () => {
      // 「嬉しい」(happy: 3) vs 「教えて」(thinking: 3) + 「方法」(thinking: 2) = thinking が勝つ
      const result = service.analyzeSentiment('嬉しいけど教えて、方法が知りたい')
      expect(result.emotion).toBe('thinking')
      expect(result.score).toBeGreaterThan(0)
    })

    it('スコアは長いキーワードほど高い', () => {
      // 「信じられない」(5文字) は 「嘘」(1文字) より高スコア
      const shortResult = service.analyzeSentiment('嘘')
      const longResult = service.analyzeSentiment('信じられない')
      expect(longResult.score).toBeGreaterThan(shortResult.score)
    })
  })
})
