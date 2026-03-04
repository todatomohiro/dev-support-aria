/**
 * テキスト感情分析サービス
 *
 * キーワードベースでテキストの感情をリアルタイム判定し、
 * Live2D 表情名（exp_01〜exp_08）を返す。
 * LLM 呼び出し不要。
 */

/** 感情カテゴリ */
type EmotionKey = 'happy' | 'sad' | 'surprised' | 'angry' | 'troubled' | 'embarrassed' | 'thinking' | 'neutral'

/** 感情分析結果 */
export interface SentimentResult {
  /** 感情カテゴリ */
  emotion: string
  /** Live2D 表情名（exp_01〜exp_08） */
  expression: string
  /** マッチスコア（0 = neutral） */
  score: number
}

/** 感情定義（内部用） */
interface EmotionDef {
  keywords: string[]
  expression: string
}

/** 感情キーワード辞書 */
const EMOTION_DEFS: Record<EmotionKey, EmotionDef> = {
  happy: {
    keywords: [
      'ありがとう', 'ありがと', '嬉しい', 'うれしい', '楽しい', 'たのしい',
      '最高', 'すごい', 'すてき', '素敵', 'やった', '好き', 'すき',
      '感謝', '幸せ', 'しあわせ', 'ワクワク', 'わくわく', '大好き', 'だいすき',
      'いいね', 'よかった', 'おめでとう', '笑', 'うける', 'ウケる',
      '元気', 'がんばる', '頑張る', 'かわいい', '可愛い', '面白い', 'おもしろい',
      '助かる', 'たすかる', '神', 'さすが', 'いい感じ',
    ],
    expression: 'exp_02',
  },
  sad: {
    keywords: [
      '悲しい', 'かなしい', 'つらい', '辛い', '寂しい', 'さびしい', 'さみしい',
      '泣く', '泣きそう', '泣いた', '落ち込', '残念', 'ざんねん',
      'しんどい', '疲れた', 'つかれた', 'だるい', 'めんどう', 'めんどくさい',
      '凹む', 'へこむ', 'がっかり', '失敗', 'ダメ', 'だめ', '無理',
      '嫌だ', 'いやだ', 'きつい', 'もう嫌',
    ],
    expression: 'exp_05',
  },
  surprised: {
    keywords: [
      'えっ', 'え！', 'びっくり', 'まさか', '驚', 'おどろ',
      '信じられない', 'しんじられない', 'うそ', 'ウソ', '嘘',
      'マジ', 'まじ', 'やばい', 'ヤバい', 'ヤバ', 'やば',
      'すげー', 'すげえ', 'なんと', 'え〜', 'えー',
      'ほんとに', '本当に', '衝撃', 'しょうげき',
    ],
    expression: 'exp_04',
  },
  angry: {
    keywords: [
      'むかつく', 'ムカつく', '怒', 'おこ', '最悪', 'さいあく',
      'うざい', 'ウザい', 'ふざけ', '許せない', 'ゆるせない',
      'イライラ', 'いらいら', 'ひどい', '酷い', 'ありえない',
      '腹立つ', 'はらたつ', 'キレ', 'きれ', 'ブチギレ',
    ],
    expression: 'exp_08',
  },
  troubled: {
    keywords: [
      '困った', 'こまった', '悩み', 'なやみ', 'どうしよう',
      'わからない', '分からない', '難しい', 'むずかしい',
      '大変', 'たいへん', 'ピンチ', 'ぴんち', '問題',
      'うーん', 'うむ', 'どうすれば', '微妙', 'びみょう',
      '心配', 'しんぱい', '不安', 'ふあん',
    ],
    expression: 'exp_07',
  },
  embarrassed: {
    keywords: [
      '恥ずかしい', 'はずかしい', '照れる', 'てれる', '照れ',
      'きゃー', 'キャー', 'いやーん', '赤面',
      'ドキドキ', 'どきどき', '緊張', 'きんちょう',
    ],
    expression: 'exp_06',
  },
  thinking: {
    keywords: [
      '教えて', 'おしえて', '知りたい', 'しりたい', '質問', 'しつもん',
      '調べて', 'しらべて', '検索', 'けんさく', 'どうやって',
      '何', 'なに', 'なぜ', 'どう', 'いつ', 'どこ', 'だれ',
      '方法', 'やり方', '仕組み', '意味', '理由', 'りゆう',
      '比較', 'おすすめ', 'オススメ', '違い', 'ちがい',
    ],
    expression: 'exp_03',
  },
  neutral: {
    keywords: [],
    expression: 'exp_01',
  },
}

/**
 * テキスト感情分析サービス
 */
export class SentimentServiceImpl {
  /**
   * テキストの感情をキーワードベースで分析
   * @param text - 分析対象のテキスト
   * @returns 感情分析結果（emotion, expression, score）
   */
  analyzeSentiment(text: string): SentimentResult {
    if (!text.trim()) {
      return { emotion: 'neutral', expression: 'exp_01', score: 0 }
    }

    const lowerText = text.toLowerCase()
    let bestEmotion: EmotionKey = 'neutral'
    let bestScore = 0

    for (const [emotion, def] of Object.entries(EMOTION_DEFS) as Array<[EmotionKey, EmotionDef]>) {
      if (emotion === 'neutral') continue

      let score = 0
      for (const keyword of def.keywords) {
        if (lowerText.includes(keyword.toLowerCase())) {
          // 長いキーワードほどスコアが高い（より特徴的）
          score += keyword.length
        }
      }

      if (score > bestScore) {
        bestScore = score
        bestEmotion = emotion
      }
    }

    return {
      emotion: bestEmotion,
      expression: EMOTION_DEFS[bestEmotion].expression,
      score: bestScore,
    }
  }
}

export const sentimentService = new SentimentServiceImpl()
