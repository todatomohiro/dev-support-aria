import type {
  LLMClientService,
  ConversationHistory,
  StructuredResponse,
  UserProfile,
} from '@/types'
import { NetworkError, APIError, RateLimitError, ParseError } from '@/types'
import { useAuthStore } from '@/auth/authStore'

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
 * LLM Client Service 実装（Bedrock Lambda プロキシ経由）
 */
class LLMClientImpl implements LLMClientService {
  private userProfile?: UserProfile

  /**
   * ユーザープロフィールを設定
   */
  setUserProfile(profile: UserProfile): void {
    this.userProfile = profile
  }

  /**
   * Lambda /llm/chat を経由して Bedrock Claude にメッセージを送信
   */
  async sendMessage(message: string, history?: ConversationHistory): Promise<StructuredResponse> {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
    const accessToken = useAuthStore.getState().accessToken

    if (!apiBaseUrl) {
      throw new APIError('API Base URL が設定されていません', 500)
    }

    // システムプロンプト構築（JSON 形式指示含む）
    const systemPrompt = buildSystemPrompt(this.userProfile) +
      '\n\n必ず以下のJSON形式で回答してください：\n{"text": "回答テキスト", "motion": "モーションタグ(idle/bow/smile/think/nod)", "emotion": "感情(neutral/happy/sad/surprised/thinking/embarrassed/troubled/angry)"}'

    // 会話履歴を {role, content} 形式に変換
    const historyMessages = (history?.messages ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    }))

    try {
      const res = await fetch(`${apiBaseUrl}/llm/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ message, history: historyMessages, systemPrompt }),
      })

      if (!res.ok) {
        const errorBody = await res.text()
        throw await this.handleAPIError(res, errorBody)
      }

      const data = (await res.json()) as { content: string }

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
