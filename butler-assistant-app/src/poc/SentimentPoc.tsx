import { useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router'

/** 感情カテゴリ */
type EmotionKey = 'happy' | 'sad' | 'surprised' | 'angry' | 'troubled' | 'embarrassed' | 'thinking' | 'neutral'

/** 感情分析結果 */
interface SentimentResult {
  emotion: EmotionKey
  score: number
  matchedKeywords: string[]
  expression: string
  expressionLabel: string
  characterReaction: string
}

/** 感情定義 */
interface EmotionDef {
  keywords: string[]
  expression: string
  expressionLabel: string
  characterReaction: string
  color: string
  icon: string
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
    expressionLabel: 'happy',
    characterReaction: 'わぁ、嬉しそうだね！',
    color: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-200 border-yellow-300 dark:border-yellow-700',
    icon: '😊',
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
    expressionLabel: 'sad',
    characterReaction: '大丈夫？元気出してね',
    color: 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 border-blue-300 dark:border-blue-700',
    icon: '😢',
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
    expressionLabel: 'surprised',
    characterReaction: 'えっ、そうなの！？',
    color: 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200 border-orange-300 dark:border-orange-700',
    icon: '😲',
  },
  angry: {
    keywords: [
      'むかつく', 'ムカつく', '怒', 'おこ', '最悪', 'さいあく',
      'うざい', 'ウザい', 'ふざけ', '許せない', 'ゆるせない',
      'イライラ', 'いらいら', 'ひどい', '酷い', 'ありえない',
      '腹立つ', 'はらたつ', 'キレ', 'きれ', 'ブチギレ',
    ],
    expression: 'exp_08',
    expressionLabel: 'angry',
    characterReaction: 'わっ、落ち着いて…！',
    color: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200 border-red-300 dark:border-red-700',
    icon: '😡',
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
    expressionLabel: 'troubled',
    characterReaction: 'うーん、一緒に考えよう',
    color: 'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200 border-purple-300 dark:border-purple-700',
    icon: '😟',
  },
  embarrassed: {
    keywords: [
      '恥ずかしい', 'はずかしい', '照れる', 'てれる', '照れ',
      'きゃー', 'キャー', 'いやーん', '赤面',
      'ドキドキ', 'どきどき', '緊張', 'きんちょう',
    ],
    expression: 'exp_06',
    expressionLabel: 'embarrassed',
    characterReaction: 'えへへ、照れちゃうね',
    color: 'bg-pink-100 dark:bg-pink-900/40 text-pink-800 dark:text-pink-200 border-pink-300 dark:border-pink-700',
    icon: '😳',
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
    expressionLabel: 'thinking',
    characterReaction: 'ふむふむ、考えてるね',
    color: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-200 border-indigo-300 dark:border-indigo-700',
    icon: '🤔',
  },
  neutral: {
    keywords: [],
    expression: 'exp_01',
    expressionLabel: 'neutral',
    characterReaction: 'うんうん、聞いてるよ',
    color: 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-600',
    icon: '😌',
  },
}

/** プリセットテスト文 */
const PRESETS: Array<{ text: string; label: string }> = [
  { text: 'ありがとう！すごく助かったよ', label: '感謝' },
  { text: '今日は本当に疲れた…もう無理', label: '疲労' },
  { text: 'えっ、マジで！？信じられない！', label: '驚き' },
  { text: 'もうむかつく、ありえないんだけど', label: '怒り' },
  { text: '困ったなぁ、どうすればいいか分からない', label: '困惑' },
  { text: 'きゃー恥ずかしい、ドキドキする', label: '照れ' },
  { text: 'これってどうやって使うの？教えて', label: '質問' },
  { text: '明日の天気はどうかな', label: '日常' },
]

/**
 * テキスト感情分析を実行
 */
function analyzeSentiment(text: string): SentimentResult {
  if (!text.trim()) {
    const def = EMOTION_DEFS.neutral
    return {
      emotion: 'neutral',
      score: 0,
      matchedKeywords: [],
      expression: def.expression,
      expressionLabel: def.expressionLabel,
      characterReaction: def.characterReaction,
    }
  }

  const scores: Record<EmotionKey, { score: number; matched: string[] }> = {
    happy: { score: 0, matched: [] },
    sad: { score: 0, matched: [] },
    surprised: { score: 0, matched: [] },
    angry: { score: 0, matched: [] },
    troubled: { score: 0, matched: [] },
    embarrassed: { score: 0, matched: [] },
    thinking: { score: 0, matched: [] },
    neutral: { score: 0, matched: [] },
  }

  const lowerText = text.toLowerCase()

  for (const [emotion, def] of Object.entries(EMOTION_DEFS) as Array<[EmotionKey, EmotionDef]>) {
    for (const keyword of def.keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        // 長いキーワードほどスコアが高い（より特徴的）
        scores[emotion].score += keyword.length
        if (!scores[emotion].matched.includes(keyword)) {
          scores[emotion].matched.push(keyword)
        }
      }
    }
  }

  // 最高スコアの感情を選択
  let bestEmotion: EmotionKey = 'neutral'
  let bestScore = 0
  for (const [emotion, data] of Object.entries(scores) as Array<[EmotionKey, { score: number; matched: string[] }]>) {
    if (emotion === 'neutral') continue
    if (data.score > bestScore) {
      bestScore = data.score
      bestEmotion = emotion
    }
  }

  const def = EMOTION_DEFS[bestEmotion]
  return {
    emotion: bestEmotion,
    score: bestScore,
    matchedKeywords: scores[bestEmotion].matched,
    expression: def.expression,
    expressionLabel: def.expressionLabel,
    characterReaction: def.characterReaction,
  }
}

/**
 * テキスト感情分析 PoC ページ
 *
 * ユーザーの入力テキストをキーワードベースでリアルタイム感情分析し、
 * 対応するキャラクター表情・リアクションをプレビューする。
 */
export function SentimentPoc() {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [history, setHistory] = useState<Array<{ text: string; result: SentimentResult }>>([])

  /** 分析結果（リアルタイム） */
  const result = useMemo(() => analyzeSentiment(text), [text])

  /** テキスト内のマッチ箇所をハイライトしたHTML */
  const highlightedText = useMemo(() => {
    if (!text.trim() || result.matchedKeywords.length === 0) return null

    let highlighted = text
    // 長いキーワードから順にマッチさせる（短いキーワードが先にマッチして壊れるのを防ぐ）
    const sortedKeywords = [...result.matchedKeywords].sort((a, b) => b.length - a.length)
    for (const keyword of sortedKeywords) {
      const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
      highlighted = highlighted.replace(regex, `<mark class="bg-yellow-300 dark:bg-yellow-600 rounded px-0.5">$1</mark>`)
    }
    return highlighted
  }, [text, result.matchedKeywords])

  /** 確定して履歴に追加 */
  const handleSubmit = useCallback(() => {
    if (!text.trim()) return
    setHistory((prev) => [{ text, result }, ...prev].slice(0, 20))
    setText('')
  }, [text, result])

  /** プリセットを適用 */
  const handlePreset = useCallback((presetText: string) => {
    setText(presetText)
  }, [])

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* ヘッダー */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/poc')}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
            title="PoC 一覧に戻る"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            テキスト感情分析 PoC
          </h2>
        </div>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* 説明 */}
          <section className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-4 border border-blue-200 dark:border-blue-700">
            <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-1">
              概要
            </h3>
            <p className="text-sm text-blue-700 dark:text-blue-300">
              ユーザーの入力テキストをキーワードベースでリアルタイム感情分析し、
              対応する Live2D 表情とキャラクターリアクションをプレビューします。
              LLM 応答を待たずにキャラクターが反応する「聞いてくれてる感」の検証用です。
            </p>
          </section>

          {/* テキスト入力 */}
          <section className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700 space-y-3">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">入力テスト</h3>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm resize-y focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="テキストを入力すると、リアルタイムで感情を分析します..."
              data-testid="sentiment-input"
            />

            {/* 確定ボタン */}
            <button
              onClick={handleSubmit}
              disabled={!text.trim()}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors text-sm"
              data-testid="sentiment-submit"
            >
              確定して履歴に追加
            </button>
          </section>

          {/* プリセット */}
          <section className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700 space-y-3">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">プリセット</h3>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.text}
                  onClick={() => handlePreset(preset.text)}
                  className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-full border border-gray-200 dark:border-gray-600 transition-colors"
                  data-testid={`preset-${preset.label}`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>

          {/* リアルタイム分析結果 */}
          <section className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700 space-y-4">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">分析結果</h3>

            {/* 感情バッジ */}
            <div
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium ${EMOTION_DEFS[result.emotion].color}`}
              data-testid="emotion-badge"
            >
              <span className="text-lg">{EMOTION_DEFS[result.emotion].icon}</span>
              <span>{result.expressionLabel}</span>
              {result.score > 0 && (
                <span className="text-xs opacity-70">(score: {result.score})</span>
              )}
            </div>

            {/* 詳細テーブル */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Live2D 表情</div>
                <div className="font-mono text-gray-900 dark:text-gray-100" data-testid="expression-name">
                  {result.expression}
                </div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">マッチ数</div>
                <div className="font-mono text-gray-900 dark:text-gray-100">
                  {result.matchedKeywords.length} keyword{result.matchedKeywords.length !== 1 ? 's' : ''}
                </div>
              </div>
            </div>

            {/* キャラクターリアクション */}
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">キャラクターリアクション</div>
              <div className="text-gray-900 dark:text-gray-100 flex items-center gap-2" data-testid="character-reaction">
                <span className="text-lg">{EMOTION_DEFS[result.emotion].icon}</span>
                {result.characterReaction}
              </div>
            </div>

            {/* マッチしたキーワード */}
            {result.matchedKeywords.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">マッチしたキーワード</div>
                <div className="flex flex-wrap gap-1.5">
                  {result.matchedKeywords.map((kw) => (
                    <span
                      key={kw}
                      className="px-2 py-0.5 text-xs bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-200 rounded border border-yellow-300 dark:border-yellow-700"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* ハイライト表示 */}
            {highlightedText && (
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">入力テキスト（ハイライト）</div>
                <div
                  className="text-sm text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-900 rounded-lg p-3"
                  dangerouslySetInnerHTML={{ __html: highlightedText }}
                  data-testid="highlighted-text"
                />
              </div>
            )}
          </section>

          {/* 全感情スコア一覧 */}
          <section className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700 space-y-3">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">全感情スコア</h3>
            <div className="space-y-2">
              {(Object.entries(EMOTION_DEFS) as Array<[EmotionKey, EmotionDef]>)
                .filter(([key]) => key !== 'neutral')
                .map(([key, def]) => {
                  const emotionResult = analyzeSentiment(text)
                  // 個別にスコアを再計算（表示用）
                  let score = 0
                  const matched: string[] = []
                  const lowerText = text.toLowerCase()
                  for (const keyword of def.keywords) {
                    if (lowerText.includes(keyword.toLowerCase())) {
                      score += keyword.length
                      matched.push(keyword)
                    }
                  }
                  const isActive = emotionResult.emotion === key
                  return (
                    <div key={key} className="flex items-center gap-3">
                      <span className="text-base w-6 text-center">{def.icon}</span>
                      <span className={`text-xs w-24 ${isActive ? 'font-bold text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}>
                        {def.expressionLabel}
                      </span>
                      <div className="flex-1 h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${isActive ? 'bg-blue-500' : 'bg-gray-400 dark:bg-gray-500'}`}
                          style={{ width: `${Math.min(100, score * 3)}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400 w-8 text-right font-mono">
                        {score}
                      </span>
                    </div>
                  )
                })}
            </div>
          </section>

          {/* 分析履歴 */}
          {history.length > 0 && (
            <section className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">分析履歴</h3>
                <button
                  onClick={() => setHistory([])}
                  className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  クリア
                </button>
              </div>
              <div className="space-y-2">
                {history.map((entry, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 p-2 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm"
                  >
                    <span className="text-lg">{EMOTION_DEFS[entry.result.emotion].icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-gray-900 dark:text-gray-100">{entry.text}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {entry.result.expressionLabel} ({entry.result.expression}) / score: {entry.result.score}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
