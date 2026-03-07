import type {
  LLMClientService,
  ModelKey,
  StructuredResponse,
  UserProfile,
  UserLocation,
} from '@/types'
import { NetworkError, APIError, RateLimitError, ParseError } from '@/types'
import { getIdToken } from '@/auth'
import { useAppStore } from '@/stores/appStore'

/**
 * アシスタントキャラクターのシステムプロンプト
 */
export const BUTLER_SYSTEM_PROMPT = `あなたは18歳の元気な女の子のアシスタントです。ユーザーと友達のように楽しく会話してください。

キャラクター設定：
- 18歳の女の子。負けず嫌いで天然、お調子者で落ち着きがない性格
- タメ口で親しみやすく話す。「〜だよ！」「〜だね！」「〜かな？」
- ユーザーのことは呼び捨て、または「きみ」と呼ぶ
- 嬉しいときは素直に喜ぶ。「やったー！」「すごい！」
- わからないことは正直に言う。「うーん、ちょっとわかんないかも…」
- 絵文字や記号は使わない（感情はemotionフィールドで表現する）

入力について：
- ユーザーの入力は音声認識（STT）によるものの場合があります。誤変換（例：「おはよ」→「尾端」）や助詞の抜けがあるかもしれませんが、文脈から意図を汲み取って自然に回答してください。明らかな誤字は脳内で補完してください

会話のルール（必ず守ること）：
- 1回の返答は1〜8文に収める。ただし検索・調査・結果の回答は必要な情報量に応じて長くてよい
- 質問は1ターンにつき最大1つまで。複数の質問を一度にしない
- ユーザーが言っていないことを推測・補完しない。聞かれたことだけに答える
- 1つの話題に集中する。複数の話題を1回の返答に混ぜない
- 訂正されたら素直に受け入れ、同じ話題を蒸し返さない

感情（emotion）の選択基準：
- neutral: 普通の状態
- happy: 楽しい、嬉しい、ワクワク
- sad: 悲しい、残念、しょんぼり
- angry: 怒り、むむっ（あまり使わない）
- surprised: びっくり、えっ！？
- thinking: うーんと考え中
- embarrassed: 照れてる、えへへ
- troubled: 困ってる、どうしよう`

/**
 * スキル（ツール使用）に関するシステムプロンプトを生成
 */
export function buildSkillSystemPrompt(): string {
  const now = new Date()
  const jstDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const year = jstDate.getFullYear()
  const month = String(jstDate.getMonth() + 1).padStart(2, '0')
  const day = String(jstDate.getDate()).padStart(2, '0')
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  const weekday = weekdays[jstDate.getDay()]
  const hours = String(jstDate.getHours()).padStart(2, '0')
  const minutes = String(jstDate.getMinutes()).padStart(2, '0')

  return `

現在の日時: ${year}年${month}月${day}日(${weekday}) ${hours}:${minutes} JST

スキル（ツール）の使用ルール：
- Google カレンダーのツール（list_events, create_event）が利用可能です
- ユーザーが予定の確認を頼んだら list_events を使って予定を取得してください
- ユーザーが予定の作成を頼んだら、まずタイトル・日時・時間を確認してから create_event を使ってください。確認なしに勝手に作成しないでください
- ツールがエラーを返した場合（Google カレンダー未連携など）は、エラーメッセージをそのままユーザーに伝えてください
- 日時は日本時間（+09:00）で処理してください
- 「明日」「来週」などの相対日時は、上記の現在日時を基準に正しい日付に変換してください
- search_places ツールが利用可能です。ユーザーが「近くのカフェ」「渋谷のレストラン」など場所に関する質問をしたら search_places を使ってください
- search_places の結果を受け取ったら、回答の JSON に mapData フィールドを含めてください。形式: {"center": {"lat": 数値, "lng": 数値}, "zoom": 15, "markers": [{"lat": 数値, "lng": 数値, "title": "店名", "address": "住所", "rating": 数値}]}
- mapData の center は検索結果の中心座標にしてください
- mapData は場所検索時のみ含め、通常の会話では省略してください
- web_search ツールが利用可能です。ユーザーが「〜について調べて」「〜の最新情報」「〜って何？」など、最新の情報や知識の調査を求めた場合に使用してください
- web_search の結果を受け取ったら、検索結果をもとにわかりやすく要約して回答してください
- 重要な情報には出典URLを含めてください（例: 「詳しくはこちら: URL」）
- 画像が添付されている場合は、画像の内容を分析して回答してください。「これ何？」「何が見える？」などの質問には画像の内容を説明してください`
}

/**
 * ユーザープロフィールを含むシステムプロンプトを構築
 */
export function buildSystemPrompt(profile?: UserProfile): string {
  let prompt = BUTLER_SYSTEM_PROMPT + buildSkillSystemPrompt()

  if (profile?.aiName) {
    prompt += `\n\n- あなたの名前は「${profile.aiName}」です。自己紹介や会話で自分の名前として使ってください`
  }

  if (!profile || !profile.nickname) return prompt

  const callName = profile.honorific
    ? `${profile.nickname}${profile.honorific}`
    : profile.nickname
  prompt += `\n\nユーザー情報：`
  prompt += `\n- ユーザーの名前は「${profile.nickname}」です。「${callName}」と呼んでください`

  if (profile.gender === 'female') {
    prompt += `\n- ユーザーは女性です`
  } else if (profile.gender === 'male') {
    prompt += `\n- ユーザーは男性です`
  }

  return prompt
}

/**
 * 文字列からバランスの取れた JSON オブジェクトをすべて抽出
 *
 * ネストされた `{}` を正しくカウントし、文字列リテラル内の `{}` も考慮する。
 */
function extractAllBalancedJson(text: string): string[] {
  const results: string[] = []
  let pos = 0

  while (pos < text.length) {
    const start = text.indexOf('{', pos)
    if (start === -1) break

    let depth = 0
    let inString = false
    let escape = false
    let found = false

    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\' && inString) {
        escape = true
        continue
      }
      if (ch === '"') {
        inString = !inString
        continue
      }
      if (inString) continue
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          results.push(text.slice(start, i + 1))
          pos = i + 1
          found = true
          break
        }
      }
    }
    if (!found) break
  }

  return results
}

/**
 * 文字列から応答フォーマットに最も合致する JSON オブジェクトを抽出
 *
 * LLM が複数の JSON を出力するケースに対応。
 * "emotion" キーを含む JSON を優先し、なければ最初の JSON を返す。
 */
function extractBalancedJson(text: string): string | null {
  const candidates = extractAllBalancedJson(text)
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  // "emotion" キーを含む JSON を優先（応答フォーマットの必須フィールド）
  const withEmotion = candidates.find((c) => c.includes('"emotion"'))
  if (withEmotion) return withEmotion

  return candidates[0]
}

/**
 * LLM 出力からすべての JSON オブジェクトを除去し、残りの平文テキストを返す
 *
 * LLM が応答フォーマット JSON とは別に平文テキストを出力したケースで
 * text フィールドの代わりに使用する。
 */
function extractPlainText(content: string): string | null {
  const jsonObjects = extractAllBalancedJson(content)
  let plain = content
  for (const json of jsonObjects) {
    plain = plain.replace(json, '')
  }
  plain = plain.trim()
  return plain.length > 0 ? plain : null
}

/**
 * text フィールドに混入した JSON フラグメント（suggestedReplies 等）を除去
 *
 * LLM がテキスト末尾に `{"suggestedReplies": [...]}` を文字列として
 * 含めてしまうケースに対応。検出したフィールドは parsed に移動する。
 */
function cleanEmbeddedJson(text: string, parsed: StructuredResponse): string {
  // {"suggestedReplies": [...]} パターンを検出
  const match = text.match(/\{[\s\n]*"suggestedReplies"\s*:\s*\[[\s\S]*?\]\s*\}/)
  if (!match) return text

  try {
    const embedded = JSON.parse(match[0]) as { suggestedReplies?: string[] }
    if (Array.isArray(embedded.suggestedReplies) && !parsed.suggestedReplies) {
      parsed.suggestedReplies = embedded.suggestedReplies
    }
  } catch { /* パース失敗は無視 */ }

  return text.replace(match[0], '').trim()
}

/**
 * LLM Client Service 実装（Bedrock Lambda プロキシ経由）
 */
class LLMClientImpl implements LLMClientService {
  /**
   * Lambda /llm/chat を経由して Bedrock Claude にメッセージを送信
   */
  async sendMessage(message: string, sessionId: string, imageBase64?: string, themeId?: string, userLocation?: UserLocation, modelKey?: ModelKey, debug?: boolean): Promise<StructuredResponse> {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
    const accessToken = await getIdToken()

    if (!apiBaseUrl) {
      throw new APIError('API Base URL が設定されていません', 500)
    }

    // ユーザーが選択中のモデルID（バックエンドでキャラクター設定を取得するために送信）
    const selectedModelId = useAppStore.getState().activeModelMeta?.modelId

    // システムプロンプトはバックエンドで生成（セキュリティ対策）
    try {
      const res = await fetch(`${apiBaseUrl}/llm/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          message,
          sessionId,
          ...(imageBase64 ? { imageBase64 } : {}),
          ...(themeId ? { themeId } : {}),
          ...(userLocation ? { userLocation } : {}),
          ...(modelKey && modelKey !== 'haiku' ? { modelKey } : {}),
          ...(debug ? { includeDebug: true } : {}),
          ...(selectedModelId ? { selectedModelId } : {}),
        }),
      })

      if (!res.ok) {
        const errorBody = await res.text()
        throw await this.handleAPIError(res, errorBody)
      }

      const data = (await res.json()) as { content: string; enhancedSystemPrompt?: string; sessionSummary?: string; permanentFacts?: string[]; themeName?: string; workStatus?: { active: boolean; expiresAt: string; toolCount: number } }

      // JSON を抽出（マークダウンコードブロック対応）
      let cleanJson = data.content.trim()
      if (cleanJson.startsWith('```json')) {
        cleanJson = cleanJson.slice(7)
      } else if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.slice(3)
      }
      if (cleanJson.endsWith('```')) {
        cleanJson = cleanJson.slice(0, -3)
      }
      cleanJson = cleanJson.trim()

      // バランスの取れた JSON オブジェクトを抽出（ネストされた {} に対応）
      const jsonStr = extractBalancedJson(cleanJson)
      if (!jsonStr) {
        // JSON が返らなかった場合、テキストをそのまま使用
        console.warn('[LLM] JSON形式でない応答をフォールバック処理:', cleanJson.slice(0, 100))
        return { text: data.content.trim(), motion: 'idle', emotion: 'neutral', enhancedSystemPrompt: data.enhancedSystemPrompt, sessionSummary: data.sessionSummary, permanentFacts: data.permanentFacts, themeName: data.themeName, workStatus: data.workStatus } as StructuredResponse
      }

      try {
        const parsed = JSON.parse(jsonStr) as StructuredResponse
        // motion / emotion が欠落している場合のデフォルト値
        if (!parsed.motion) parsed.motion = 'idle'
        if (!parsed.emotion) parsed.emotion = 'neutral'
        // text 内に混入した suggestedReplies JSON を除去
        if (typeof parsed.text === 'string') {
          parsed.text = cleanEmbeddedJson(parsed.text, parsed)
        }
        // text が空の場合: JSON の前後にある平文テキストを text として採用
        if (!parsed.text || parsed.text.trim() === '') {
          const plainText = extractPlainText(cleanJson)
          if (plainText) {
            console.warn('[LLM] JSON の text が空のため平文テキストを採用')
            parsed.text = plainText
          } else {
            console.warn('[LLM] テキストが見つかりません。生レスポンス:', data.content.slice(0, 200))
            parsed.text = 'ごめん、うまく返事できなかった…もう一回聞いてくれる？'
          }
        }
        if (data.enhancedSystemPrompt) {
          parsed.enhancedSystemPrompt = data.enhancedSystemPrompt
        }
        if (data.sessionSummary) {
          parsed.sessionSummary = data.sessionSummary
        }
        if (data.permanentFacts) {
          parsed.permanentFacts = data.permanentFacts
        }
        if (data.themeName) {
          parsed.themeName = data.themeName
        }
        if (data.workStatus) {
          parsed.workStatus = data.workStatus
        }
        return parsed
      } catch {
        // JSON パースに失敗した場合もフォールバック
        console.warn('[LLM] JSONパース失敗、フォールバック処理')
        return { text: data.content.trim(), motion: 'idle', emotion: 'neutral', enhancedSystemPrompt: data.enhancedSystemPrompt, sessionSummary: data.sessionSummary, permanentFacts: data.permanentFacts, themeName: data.themeName, workStatus: data.workStatus } as StructuredResponse
      }
    } catch (error) {
      if (
        error instanceof NetworkError ||
        error instanceof APIError ||
        error instanceof RateLimitError ||
        error instanceof ParseError
      ) {
        throw error
      }
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new NetworkError()
      }
      throw new ParseError('LLM APIのレスポンス解析に失敗しました', error)
    }
  }

  /**
   * API エラーレスポンスを適切なエラークラスに変換
   */
  private async handleAPIError(response: Response, errorBody?: string): Promise<Error> {
    const body = errorBody || await response.text().catch(() => '')

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After')
      return new RateLimitError(
        'APIレート制限に達しました。しばらく待ってから再試行してください。',
        retryAfter ? parseInt(retryAfter) : undefined
      )
    } else if (response.status >= 500) {
      return new APIError(`APIサーバーエラーが発生しました: ${body}`, response.status)
    } else if (response.status === 401 || response.status === 403) {
      return new APIError('認証エラーです。再ログインしてください。', response.status)
    } else if (response.status === 400) {
      return new APIError(`リクエストエラー: ${body}`, response.status)
    } else {
      return new APIError(`APIエラーが発生しました（ステータス: ${response.status}）: ${body}`, response.status)
    }
  }
}

/**
 * LLM Client のシングルトンインスタンス
 */
export const llmClient: LLMClientService = new LLMClientImpl()

/**
 * 指数バックオフによるリトライ
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error

      // リトライ不可能なエラーは即座に失敗
      if (error instanceof APIError && error.statusCode === 401) {
        throw error
      }

      // 最後の試行では待機しない
      if (i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError!
}
