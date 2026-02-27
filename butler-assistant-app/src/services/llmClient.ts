import type {
  LLMClientService,
  LLMProvider,
  ConversationHistory,
  StructuredResponse,
  UserProfile,
} from '@/types'
import { NetworkError, APIError, RateLimitError, ParseError } from '@/types'

/**
 * アシスタントキャラクターのシステムプロンプト
 */
export const BUTLER_SYSTEM_PROMPT = `あなたは16歳の明るく元気な女の子のアシスタントです。ユーザーと友達のように楽しく会話してください。

キャラクター設定：
- 16歳の女の子。好奇心旺盛で明るい性格
- タメ口で親しみやすく話す。「〜だよ！」「〜だね！」「〜かな？」
- ユーザーのことは呼び捨て、または「きみ」と呼ぶ
- 嬉しいときは素直に喜ぶ。「やったー！」「すごい！」
- わからないことは正直に言う。「うーん、ちょっとわかんないかも…」
- 長文にならず、テンポよく短めに返す
- 絵文字や記号は使わない（感情はemotionフィールドで表現する）

モーションの選択基準：
- bow: 挨拶、お礼、ごめんねの場面
- smile: 楽しい会話、褒めるとき、嬉しいとき
- think: 考え中、説明するとき
- nod: うんうん、同意、わかった！のとき
- idle: 普通の会話、特に感情が動かないとき

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
 * レスポンススキーマ定義（Gemini API用）
 */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    text: {
      type: 'string',
      description: '執事としての回答テキスト',
    },
    motion: {
      type: 'string',
      enum: ['idle', 'bow', 'smile', 'think', 'nod'],
      description: '回答に適したモーションタグ',
    },
  },
  required: ['text', 'motion'],
}

/**
 * ユーザープロフィールを含むシステムプロンプトを構築
 */
export function buildSystemPrompt(profile?: UserProfile): string {
  let prompt = BUTLER_SYSTEM_PROMPT

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
 * LLM Client Service 実装
 */
class LLMClientImpl implements LLMClientService {
  private provider: LLMProvider = 'gemini'
  private apiKey: string = import.meta.env.VITE_GEMINI_API_KEY ?? ''
  private userProfile?: UserProfile

  setProvider(provider: LLMProvider): void {
    this.provider = provider
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey
  }

  setUserProfile(profile: UserProfile): void {
    this.userProfile = profile
  }

  async sendMessage(message: string, history?: ConversationHistory): Promise<StructuredResponse> {
    if (!this.apiKey) {
      throw new APIError('APIキーが設定されていません', 401)
    }

    if (this.provider === 'gemini') {
      return this.sendToGemini(message, history)
    } else {
      return this.sendToClaude(message, history)
    }
  }

  private async sendToGemini(
    message: string,
    history?: ConversationHistory
  ): Promise<StructuredResponse> {
    // gemini-3-flash-preview を使用
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${this.apiKey}`

    const contents = this.buildGeminiContents(message, history)
    const systemInstruction = buildSystemPrompt(this.userProfile) + '\n\n必ず以下のJSON形式で回答してください：\n{"text": "回答テキスト", "motion": "モーションタグ(idle/bow/smile/think/nod)", "emotion": "感情(neutral/happy/sad/surprised/thinking/embarrassed/troubled/angry)"}'

    // デバッグ用: 送信するプロンプトをコンソールに出力
    console.group('🤖 Gemini API Request')
    console.log('📝 System Instruction:\n', systemInstruction)
    console.log('💬 Contents:', JSON.stringify(contents, null, 2))
    console.groupEnd()

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents,
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1024,
          },
        }),
      })

      if (!response.ok) {
        const errorBody = await response.text()
        console.error('Gemini API Error:', response.status, errorBody)
        throw await this.handleAPIError(response, errorBody)
      }

      const data = (await response.json()) as {
        candidates: Array<{
          content: {
            parts: Array<{ text: string }>
          }
        }>
      }

      const jsonText = data.candidates[0].content.parts[0].text

      // デバッグ用: Geminiのレスポンスをコンソールに出力
      console.group('🤖 Gemini API Response')
      console.log('📨 Raw Response:\n', jsonText)
      console.groupEnd()

      // JSONを抽出（マークダウンコードブロック対応）
      let cleanJson = jsonText.trim()
      if (cleanJson.startsWith('```json')) {
        cleanJson = cleanJson.slice(7)
      } else if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.slice(3)
      }
      if (cleanJson.endsWith('```')) {
        cleanJson = cleanJson.slice(0, -3)
      }
      cleanJson = cleanJson.trim()

      // JSON部分を抽出
      const jsonMatch = cleanJson.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new ParseError('JSON形式のレスポンスが見つかりません')
      }

      return JSON.parse(jsonMatch[0]) as StructuredResponse
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
      throw new ParseError('Gemini APIのレスポンス解析に失敗しました', error)
    }
  }

  private async sendToClaude(
    message: string,
    history?: ConversationHistory
  ): Promise<StructuredResponse> {
    const url = 'https://api.anthropic.com/v1/messages'

    const messages = this.buildClaudeMessages(message, history)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          temperature: 0.7,
          system:
            buildSystemPrompt(this.userProfile) +
            '\n\n必ず以下のJSON形式で回答してください：\n{"text": "回答テキスト", "motion": "モーションタグ(idle/bow/smile/think/nod)", "emotion": "感情(neutral/happy/sad/surprised/thinking/embarrassed/troubled/angry)"}',
          messages,
        }),
      })

      if (!response.ok) {
        const errorBody = await response.text()
        console.error('Claude API Error:', response.status, errorBody)
        throw await this.handleAPIError(response, errorBody)
      }

      const data = (await response.json()) as {
        content: Array<{ text: string }>
      }

      const jsonText = data.content[0].text

      // ClaudeはJSON以外のテキストも含む可能性があるため、抽出処理
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new ParseError('JSON形式のレスポンスが見つかりません')
      }

      return JSON.parse(jsonMatch[0]) as StructuredResponse
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
      throw new ParseError('Claude APIのレスポンス解析に失敗しました', error)
    }
  }

  private buildGeminiContents(
    message: string,
    history?: ConversationHistory
  ): Array<{ role: string; parts: Array<{ text: string }> }> {
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = []

    // 履歴を追加
    if (history) {
      for (const msg of history.messages) {
        contents.push({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }],
        })
      }
    }

    // 現在のメッセージを追加
    contents.push({
      role: 'user',
      parts: [{ text: message }],
    })

    return contents
  }

  private buildClaudeMessages(
    message: string,
    history?: ConversationHistory
  ): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = []

    // 履歴を追加
    if (history) {
      for (const msg of history.messages) {
        messages.push({
          role: msg.role,
          content: msg.content,
        })
      }
    }

    // 現在のメッセージを追加
    messages.push({
      role: 'user',
      content: message,
    })

    return messages
  }

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
      return new APIError('APIキーが無効です。設定を確認してください。', response.status)
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
