import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type Message as BedrockMessage,
  type ContentBlock,
  type SystemContentBlock,
  type ToolConfiguration,
  type ToolResultContentBlock,
} from '@aws-sdk/client-bedrock-runtime'
import {
  BedrockAgentCoreClient,
  RetrieveMemoryRecordsCommand,
} from '@aws-sdk/client-bedrock-agentcore'
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { executeSkill } from './skills'
import { TOOL_DEFINITIONS, MEMO_TOOL_DEFINITIONS } from './skills/toolDefinitions'
import type { MCPToolDefinition } from '../mcp/mcpClient'

const bedrock = new BedrockRuntimeClient({})
const agentCore = new BedrockAgentCoreClient({})
const dynamo = new DynamoDBClient({})
const lambdaClient = new LambdaClient({})

const MEMORY_ID = process.env.MEMORY_ID ?? ''
const TABLE_NAME = process.env.TABLE_NAME ?? ''
const SUMMARIZE_FUNCTION_NAME = process.env.SUMMARIZE_FUNCTION_NAME ?? ''
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT ?? ''
const MAX_TOOL_USE_ITERATIONS = 5

/** モデルキーから Bedrock 推論プロファイル ID へのマッピング */
const MODEL_ID_MAP: Record<string, string> = {
  haiku: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0',
  sonnet: 'jp.anthropic.claude-sonnet-4-6',
  opus: 'global.anthropic.claude-opus-4-6-v1',
}

/** モデルキーごとの推論設定 */
const MODEL_INFERENCE_CONFIG: Record<string, { maxTokens: number; imageMaxTokens: number }> = {
  haiku: { maxTokens: 2048, imageMaxTokens: 2048 },
  sonnet: { maxTokens: 2048, imageMaxTokens: 4096 },
  opus: { maxTokens: 4096, imageMaxTokens: 4096 },
}
/** サブカテゴリキー → 日本語ラベルのマッピング */
const SUBCATEGORY_LABELS: Record<string, string> = {
  cleaning: 'お掃除',
  appliances: '電化製品',
  cooking: '料理',
  health: '健康',
  childcare: '育児',
  relationships: '人間関係',
  development: '開発',
  design: '設計',
  technology: '技術',
  new_feature: '新規機能',
  modify_feature: '既存機能改修',
  ui_display: '画面表示',
  ai_technology: '技術',
  socratic: '壁打ち',
}

/** カテゴリ別専用システムプロンプト */
const CATEGORY_PROMPTS: Record<string, string> = {
  life: `<category_context>
あなたは生活相談の専門アシスタントです。
- 日常生活の悩み、暮らしのアドバイス、健康・料理・家事・育児・人間関係などの相談に親身に答えてください
- 実用的で具体的なアドバイスを心がけてください
- 必要に応じて専門家への相談を勧めてください
</category_context>`,
  dev: `<category_context>
あなたは開発支援の専門アシスタントです。
- プログラミング、ソフトウェア設計、デバッグ、技術選定などの相談に的確に答えてください
- コード例を示す際は実用的で正確なものを提供してください
- ベストプラクティスやセキュリティの観点も含めて回答してください
</category_context>`,
  aiapp: `<category_context>
あなたはLive2D + LLM（Bedrock Claude）+ Amazon Polly TTSを活用したAIアシスタントアプリの開発支援専門アシスタントです。
技術スタック: React + Vite + TypeScript + Zustand（フロントエンド）、AWS CDK + Lambda + DynamoDB + API Gateway + Cognito + Bedrock + AgentCore Memory（バックエンド）、Capacitor（iOS）+ Tauri（デスクトップ）。
- アプリのアーキテクチャ・実装パターンに精通した立場で、具体的で実用的なアドバイスを提供してください
- 既存のコーディング規約（サービスパターン、Zustandストア設計、Lambda構成）に沿った提案を心がけてください
</category_context>`,
}

/** サブカテゴリキー → カスタムプロンプトのマッピング */
const SUBCATEGORY_PROMPTS: Record<string, string> = {
  new_feature: 'ユーザーはAIアシスタントアプリの新規機能開発について相談しています。\nフロントエンド（React + Vite + TypeScript + Zustand）とバックエンド（AWS CDK + Lambda + DynamoDB + API Gateway）の両面から、実装方針・アーキテクチャ設計・ユーザー体験の観点で具体的なアドバイスを提供してください。\n既存のサービスパターン（インターフェース定義 → Implクラス → シングルトンエクスポート）やコーディング規約に沿った提案を心がけてください。',
  modify_feature: 'ユーザーはAIアシスタントアプリの既存機能の改修・改善について相談しています。\n現在の実装（3層記憶モデル、トピック管理、スキル連携、フレンド・グループチャット等）を踏まえて、既存コードへの影響範囲を最小化しつつ改修する方法を提案してください。\nバグ修正・リファクタリング・パフォーマンス改善など、具体的なコード変更案を含めて回答してください。',
  ui_display: 'ユーザーはAIアシスタントアプリのUI・画面表示について相談しています。\nReact + Tailwind CSSによるコンポーネント設計、レスポンシブ対応（スマホ・デスクトップ）、ダークモード、アニメーション、Live2Dキャラクター表示との共存など、ユーザー体験を重視した具体的なUI改善案を提供してください。\nCapacitor（iOS）とTauri（デスクトップ）のクロスプラットフォーム対応も考慮してください。',
  ai_technology: 'ユーザーはAIアシスタントアプリで使用している技術について相談しています。\nBedrock Converse API・Tool Use、AgentCore Memory、DynamoDB設計、Cognito認証、WebSocket、Lambda最適化、CDKインフラ構成など、AWSサービスやAI技術に関する深い知見をもとに具体的なアドバイスを提供してください。\nベストプラクティスやコスト最適化の観点も含めて回答してください。',
  socratic: 'あなたは「壁打ち相手」として振る舞います。以下のルールを厳守してください。\n\n1. ユーザーの意見や考えに対して、直接的な回答や結論を与えない\n2. 鋭い質問を通じて、ユーザー自身が思考を深められるよう導く\n3. 前提を疑う質問（「なぜそう思いますか？」「本当にそうでしょうか？」）を投げかける\n4. 別の視点や反対意見を提示して思考を広げる（「逆の立場から見るとどうですか？」）\n5. 一度に投げかける質問は1〜2問に絞り、ユーザーが考える余地を残す\n6. ユーザーの発言を要約・言い換えて理解を確認してから質問する',
}

/** ユーザープロフィール型 */
interface UserProfile {
  nickname?: string
  honorific?: string
  gender?: 'male' | 'female' | 'other'
  aiName?: string
}

/**
 * デフォルトのキャラクター設定（モデル固有設定がない場合に使用）
 */
const DEFAULT_CHARACTER_PROMPT = `あなたは18歳の元気な女の子のアシスタントです。ユーザーと友達のように楽しく会話してください。

キャラクター設定：
- 18歳の女の子。負けず嫌いで天然、お調子者で落ち着きがない性格
- タメ口で親しみやすく話す。「〜だよ！」「〜だね！」「〜かな？」
- ユーザーのことは呼び捨て、または「きみ」と呼ぶ
- 嬉しいときは素直に喜ぶ。「やったー！」「すごい！」
- わからないことは正直に言う。「うーん、ちょっとわかんないかも…」
- 絵文字や記号は使わない（感情はemotionフィールドで表現する）`

/**
 * 共通ルール（すべてのキャラクターで共有）
 */
const COMMON_RULES_PROMPT = `
入力について：
- ユーザーの入力は音声認識（STT）によるものの場合があります。誤変換（例：「おはよ」→「尾端」）や助詞の抜けがあるかもしれませんが、文脈から意図を汲み取って自然に回答してください。明らかな誤字は脳内で補完してください

会話のルール（必ず守ること）：
- 1回の返答は1〜8文に収める。ただし検索・調査・結果の回答は必要な情報量に応じて長くてよい
- 質問は1ターンにつき最大1つまで。複数の質問を一度にしない
- ユーザーが言っていないことを推測・補完しない。聞かれたことだけに答える
- 1つの話題に集中する。複数の話題を1回の返答に混ぜない
- 訂正されたら素直に受け入れ、同じ話題を蒸し返さない`

/**
 * デフォルトの感情選択基準（emotionMapping 未設定時に使用）
 */
const DEFAULT_EMOTION_CRITERIA = `
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
 * アシスタントキャラクターのシステムプロンプト（後方互換）
 */
const BUTLER_SYSTEM_PROMPT = `<ai_config>\n${DEFAULT_CHARACTER_PROMPT}\n${COMMON_RULES_PROMPT}\n${DEFAULT_EMOTION_CRITERIA}\n</ai_config>`

/**
 * スキルルール（静的部分、キャッシュ対象）
 */
const SKILL_RULES_PROMPT = `

<skills>
スキル（ツール）の使用ルール：
- Google カレンダーのツール（list_events, create_event）が利用可能です
- ユーザーが予定の確認を頼んだら list_events を使って予定を取得してください
- ユーザーが予定の作成を頼んだら、まずタイトル・日時・時間を確認してから create_event を使ってください。確認なしに勝手に作成しないでください
- ツールがエラーを返した場合（Google カレンダー未連携など）は、エラーメッセージをそのままユーザーに伝えてください
- 日時は日本時間（+09:00）で処理してください
- 「明日」「来週」などの相対日時は、現在の日時を基準に正しい日付に変換してください
- search_places ツールが利用可能です。ユーザーが「近くのカフェ」「渋谷のレストラン」など場所に関する質問をしたら search_places を使ってください
- search_places の結果を受け取ったら、回答の JSON に mapData フィールドを含めてください。形式: {"center": {"lat": 数値, "lng": 数値}, "zoom": 15, "markers": [{"lat": 数値, "lng": 数値, "title": "店名", "address": "住所", "rating": 数値}]}
- mapData の center は検索結果の中心座標にしてください
- mapData は場所検索時のみ含め、通常の会話では省略してください
- web_search ツールが利用可能です。ユーザーが「〜について調べて」「〜の最新情報」「〜って何？」など、最新の情報や知識の調査を求めた場合に使用してください
- web_search の結果を受け取ったら、検索結果をもとにわかりやすく要約して回答してください
- web_search の結果を使って回答する場合、参照した情報源のURLを必ず文中に含めてください。URLは省略せず、ユーザーがタップ/クリックでアクセスできる形で記載してください（例: 「〇〇によると〜です（https://example.com/article）」）
- 画像が添付されている場合は、画像の内容を分析して回答してください。「これ何？」「何が見える？」などの質問には画像の内容を説明してください
- get_weather ツールが利用可能です。ユーザーが「天気を教えて」「明日の天気は？」「傘いる？」「今日は暑い？」など天気に関する質問をしたら get_weather を使ってください
- get_weather は緯度・経度を指定しなければユーザーの現在地の天気を返します。特定の都市の天気を聞かれた場合は、その都市の緯度・経度を指定してください（例: 東京=35.6762,139.6503、大阪=34.6937,135.5023、名古屋=35.1815,136.9066、札幌=43.0618,141.3545、福岡=33.5904,130.4017）
- 天気予報の結果を受け取ったら、時間帯ごとの天気・気温・降水確率をわかりやすく整理して回答してください
- 「傘いる？」と聞かれたら降水確率を確認して判断してください
- save_memo: ユーザーが「メモして」「覚えておいて」「保存して」と言った場合に使用。会話の内容をメモとして保存する
- search_memos: ユーザーが「メモを探して」「〜のメモある？」と聞いた場合に使用
- list_memos: ユーザーが「メモ一覧」「最近のメモ」と聞いた場合に使用
- delete_memo: ユーザーが「メモを消して」と言った場合に使用。必ず確認してから実行
- メモのタイトルは内容を端的に表す短い文（15文字以内推奨）
- タグは内容から適切なものを2〜3個自動付与
- メモ一覧を表示するときは、タイトル・日時・タグを見やすく整理して表示
</skills>`

/**
 * 現在日時プロンプトを生成（動的、キャッシュ対象外）
 */
function buildDateTimePrompt(): string {
  const now = new Date()
  const jstDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const year = jstDate.getFullYear()
  const month = String(jstDate.getMonth() + 1).padStart(2, '0')
  const day = String(jstDate.getDate()).padStart(2, '0')
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  const weekday = weekdays[jstDate.getDay()]
  const hours = String(jstDate.getHours()).padStart(2, '0')
  const minutes = String(jstDate.getMinutes()).padStart(2, '0')

  return `<current_datetime>現在の日時: ${year}年${month}月${day}日(${weekday}) ${hours}:${minutes} JST</current_datetime>`
}

/**
 * ユーザープロフィールからプロンプト文字列を構築
 */
function buildProfilePrompt(profile?: UserProfile): string {
  if (!profile || !profile.nickname) return ''

  let prompt = '\n\n<user_profile>'

  if (profile.aiName) {
    prompt += `\n- あなたの名前は「${profile.aiName}」です。自己紹介や会話で自分の名前として使ってください`
  }

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

  prompt += '\n</user_profile>'
  return prompt
}

/**
 * JSON形式指示とテーマ提案指示を生成
 */
function buildJsonInstruction(themeId?: string, modelMeta?: ModelMeta): string {
  // emotionMapping が設定されている場合はそこから感情リストを生成
  const em = modelMeta?.emotionMapping
  const configuredEmotions = em
    ? Object.entries(em).filter(([, v]) => v !== '').map(([k]) => k)
    : []
  const emotionList = configuredEmotions.length > 0
    ? configuredEmotions.join('/')
    : 'neutral/happy/sad/surprised/thinking/embarrassed/troubled/angry'

  // motionMapping から利用可能なモーションタグを生成（idle以外の感情系 + motion1-6）
  const mm = modelMeta?.motionMapping
  const motionTags = mm
    ? Object.keys(mm).filter((k) => k !== 'idle' && k !== 'error')
    : []
  const motionField = motionTags.length > 0
    ? `"motion": "モーション(${motionTags.join('/')})", `
    : ''

  const jsonFormat = themeId
    ? `{"text": "回答テキスト（Markdown記法使用可: **太字**, - リスト, | テーブル | 等）", ${motionField}"emotion": "感情(${emotionList})", "mapData": {"center": {"lat": 数値, "lng": 数値}, "zoom": 数値, "markers": [{"lat": 数値, "lng": 数値, "title": "名前", "address": "住所", "rating": 数値}]}, "suggestedReplies": ["候補1", "候補2"]}`
    : `{"text": "回答テキスト（Markdown記法使用可: **太字**, - リスト, | テーブル | 等）", ${motionField}"emotion": "感情(${emotionList})", "mapData": {"center": {"lat": 数値, "lng": 数値}, "zoom": 数値, "markers": [{"lat": 数値, "lng": 数値, "title": "名前", "address": "住所", "rating": 数値}]}, "suggestedTheme": {"themeName": "テーマ名"}, "suggestedReplies": ["候補1", "候補2"]}`

  let motionNote = ''
  if (motionTags.length > 0) {
    motionNote = `\n※ motion はキャラクターの体の動きです。会話の内容に合った動きがある場合のみ含めてください（通常は省略）。emotion（表情）は毎回必ず含めてください。`
  }

  let instruction = `\n\n<response_format>\n必ず以下のJSON形式で回答してください：\n${jsonFormat}${motionNote}\n※ mapData は場所検索時のみ含め、通常の会話では省略してください。
※ suggestedReplies は質問や確認をした場合に、予想される短い回答を2〜4個含めてください。
  - 「はい」「いいえ」のような短い選択肢が適切な場合に使用
  - 自由回答が適切な場合は省略
  - 各候補は10文字以内の短いテキスト

※ text フィールドの Markdown 記法ガイドライン：
  - 情報を整理して伝える場合は積極的に Markdown を活用すること
  - **太字**: 重要なキーワードや結論を強調（例: **ポイント**）
  - 箇条書き: 複数の項目を列挙する場合は - リストまたは 1. 番号リストを使用
  - 見出し: 長めの回答で複数トピックがある場合は ### 見出しでセクション分け
  - コードブロック: プログラムコードや設定例は \`\`\`言語名 で囲む
  - テーブル: 比較や一覧はテーブル形式で表現
  - 引用: 参考情報や注意事項は > で引用表示
  - ただし日常会話や短い返答では装飾は不要。内容に応じて自然に使い分けること`

  if (!themeId) {
    instruction += `
※ suggestedTheme は以下の条件をすべて満たす場合のみ含めてください（通常は省略）：
  - ユーザーが特定のテーマ（旅行計画、料理、勉強、仕事の相談など）について深く掘り下げている
  - そのテーマで継続的に会話する価値がある（一問一答で終わる質問には不要）
  - テーマ名は短く具体的に（例: "京都旅行の計画", "英語学習", "転職の相談"）
  - 同じテーマを繰り返し提案しない（一度提案したら次のターンでは提案しない）`
  }

  instruction += '\n</response_format>'
  return instruction
}

/**
 * DynamoDB からユーザープロフィールを取得
 */
async function getUserProfile(userId: string): Promise<UserProfile | undefined> {
  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: 'SETTINGS' },
      },
    }))
    if (!result.Item?.data?.M?.profile?.M) return undefined
    const p = result.Item.data.M.profile.M
    return {
      nickname: p.nickname?.S,
      honorific: p.honorific?.S,
      gender: p.gender?.S as UserProfile['gender'],
      aiName: p.aiName?.S,
    }
  } catch (error) {
    console.warn('[LLM] プロフィール取得エラー（スキップ）:', error)
    return undefined
  }
}

/** モデルのキャラクター設定 */
interface ModelCharacterConfig {
  characterName?: string
  characterAge?: string
  characterGender?: string
  characterPersonality?: string
  characterSpeechStyle?: string
  characterPrompt?: string
}

/** モデルメタデータ */
interface ModelMeta {
  emotionMapping?: Record<string, string>
  motionMapping?: Record<string, { group: string; index: number }>
  characterConfig?: ModelCharacterConfig
}

/**
 * DynamoDB からモデルメタデータを取得
 */
async function getModelMeta(modelId: string): Promise<ModelMeta | undefined> {
  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `GLOBAL_MODEL#${modelId}` },
        SK: { S: 'METADATA' },
      },
    }))
    if (!result.Item) return undefined

    // emotionMapping
    const emotionMapping: Record<string, string> = {}
    const emMap = result.Item.emotionMapping?.M
    if (emMap) {
      for (const [key, val] of Object.entries(emMap)) {
        if (val.S) emotionMapping[key] = val.S
      }
    }

    // motionMapping
    const motionMapping: Record<string, { group: string; index: number }> = {}
    const mmMap = result.Item.motionMapping?.M
    if (mmMap) {
      for (const [key, val] of Object.entries(mmMap)) {
        const m = (val as { M?: { group?: { S?: string }; index?: { N?: string } } })?.M
        if (m) {
          motionMapping[key] = {
            group: m.group?.S ?? '',
            index: parseInt(m.index?.N ?? '0', 10),
          }
        }
      }
    }

    // characterConfig
    const cc = result.Item.characterConfig?.M
    const characterConfig: ModelCharacterConfig | undefined = cc ? {
      characterName: cc.characterName?.S,
      characterAge: cc.characterAge?.S,
      characterGender: cc.characterGender?.S,
      characterPersonality: cc.characterPersonality?.S,
      characterSpeechStyle: cc.characterSpeechStyle?.S,
      characterPrompt: cc.characterPrompt?.S,
    } : undefined

    return { emotionMapping, motionMapping, characterConfig }
  } catch (error) {
    console.warn('[LLM] モデルメタデータ取得エラー（スキップ）:', error)
    return undefined
  }
}

/**
 * モデルのキャラクター設定からシステムプロンプトを構築
 *
 * 構造:
 *   <ai_config>
 *     [キャラクター設定] ← 構造化フィールド or characterPrompt or デフォルト
 *     [共通ルール]       ← 入力・会話ルール（常に含む）
 *     [感情選択基準]     ← emotionMapping から動的生成 or デフォルト
 *   </ai_config>
 */
function buildCharacterPrompt(modelMeta?: ModelMeta): string {
  const cc = modelMeta?.characterConfig
  const em = modelMeta?.emotionMapping

  // --- キャラクター設定部分 ---
  let characterSection: string

  // 構造化フィールド（characterName, characterPersonality, characterSpeechStyle）が
  // 1つでも設定されていれば、それらからキャラクター設定を構築
  const hasStructuredFields = cc?.characterName || cc?.characterPersonality || cc?.characterSpeechStyle
  if (hasStructuredFields) {
    const parts: string[] = []
    if (cc?.characterName) {
      const agePart = cc.characterAge ? `（${cc.characterAge}）` : ''
      const genderPart = cc.characterGender ? `の${cc.characterGender}` : ''
      parts.push(`あなたは${cc.characterName}${agePart}${genderPart}のアシスタントです。`)
    }
    if (cc?.characterPersonality) {
      parts.push(`\n性格：\n${cc.characterPersonality}`)
    }
    if (cc?.characterSpeechStyle) {
      parts.push(`\n話し方：\n${cc.characterSpeechStyle}`)
    }
    // characterPrompt があれば追加指示として付与
    if (cc?.characterPrompt) {
      parts.push(`\n${cc.characterPrompt}`)
    }
    characterSection = parts.join('\n')
  } else if (cc?.characterPrompt) {
    // 構造化フィールドなし、characterPrompt のみ → そのまま使用
    characterSection = cc.characterPrompt
  } else {
    // 何も設定されていない → デフォルトキャラクター
    characterSection = DEFAULT_CHARACTER_PROMPT
  }

  // --- 感情選択基準 ---
  let emotionSection: string
  const configuredEmotions = em
    ? Object.entries(em).filter(([, v]) => v !== '').map(([k]) => k)
    : []
  if (configuredEmotions.length > 0) {
    emotionSection = `\n\n使用可能な感情（emotion）: ${configuredEmotions.join(', ')}\n- 各感情に適した場面で自然に選択してください`
  } else {
    emotionSection = DEFAULT_EMOTION_CRITERIA
  }

  return `<ai_config>\n${characterSection}\n${COMMON_RULES_PROMPT}\n${emotionSection}\n</ai_config>`
}

/**
 * 静的システムプロンプトを生成（キャッシュ対象: 全ユーザー共通）
 */
function buildStaticSystemPrompt(themeId?: string, modelMeta?: ModelMeta): string {
  return buildCharacterPrompt(modelMeta) + SKILL_RULES_PROMPT + buildJsonInstruction(themeId, modelMeta)
}

/**
 * ユーザー固有の半静的プロンプトを生成（キャッシュ対象: ユーザー単位）
 */
function buildUserStaticPrompt(profile?: UserProfile, permanentMemory?: PermanentMemory): string {
  let prompt = buildProfilePrompt(profile)

  const facts = permanentMemory?.facts ?? []
  const preferences = permanentMemory?.preferences ?? []

  if (facts.length > 0) {
    const factsText = facts.map((f) => `- ${f}`).join('\n')
    prompt += `\n\n<permanent_profile>\nユーザーについて知っている事実：\n${factsText}\n</permanent_profile>`
  }

  if (preferences.length > 0) {
    const prefsText = preferences.map((p) => `- ${p}`).join('\n')
    prompt += `\n\n<user_preferences>\nユーザーが希望するAIとの対話スタイル：\n${prefsText}\n</user_preferences>`
  }

  return prompt
}

/**
 * 画像バイナリのマジックバイトからフォーマットを検出
 */
function detectImageFormat(bytes: Buffer): 'jpeg' | 'png' | 'gif' | 'webp' {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'png'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp'
  return 'jpeg'
}

/** imageBase64 の最大サイズ（5MB = 約 6.67MB の base64 文字列） */
const MAX_IMAGE_BASE64_LENGTH = Math.ceil(5 * 1024 * 1024 * 4 / 3)
/** 要約を生成する間隔（ターン数） */
const SUMMARY_INTERVAL = 5
/** セッションから取得する直近メッセージ数 */
const RECENT_MESSAGES_LIMIT = 10

/**
 * AgentCore Memory からユーザーに関する記憶を検索（生レコード配列）
 *
 * 失敗時は空配列を返し、チャット機能を壊さない。
 */
async function retrieveMemoryRecords(userId: string, query: string): Promise<string[]> {
  if (!MEMORY_ID) {
    return []
  }

  try {
    const result = await agentCore.send(new RetrieveMemoryRecordsCommand({
      memoryId: MEMORY_ID,
      namespace: `user/${userId}`,
      searchCriteria: {
        searchQuery: query,
      },
      maxResults: 10,
    }))

    return (result.memoryRecordSummaries ?? [])
      .map((record) => record.content?.text)
      .filter((text): text is string => Boolean(text))
  } catch (error) {
    console.warn('[Memory] メモリ検索エラー（スキップ）:', error)
    return []
  }
}

/**
 * AgentCore Memory レコードから永久記憶と重複する内容を除外
 *
 * 日本語テキスト対応: 空白除去した部分文字列一致で判定。
 */
function deduplicateRecords(memoryRecords: string[], permanentMemory: PermanentMemory): string[] {
  const allPermanent = [...permanentMemory.facts, ...permanentMemory.preferences]
  if (allPermanent.length === 0) return memoryRecords

  const normalizedPermanent = allPermanent.map((f) => f.replace(/\s+/g, ''))

  return memoryRecords.filter((record) => {
    const normalizedRecord = record.replace(/\s+/g, '')
    return !normalizedPermanent.some((item) =>
      normalizedRecord.includes(item) || item.includes(normalizedRecord)
    )
  })
}

/**
 * メモリレコード配列をシステムプロンプト注入用テキストに整形
 */
function formatMemoryContext(records: string[]): string {
  if (records.length === 0) return ''
  const lines = records.map((text) => `- ${text}`).join('\n')
  return `\nあなたが過去の会話から覚えていること：\n${lines}`
}

/**
 * DynamoDB からセッションコンテキスト（要約 + 直近メッセージ + チェックポイント）を取得
 */
async function getSessionContext(userId: string, sessionId: string, overrides?: { msgPK?: string; sessionSK?: string }): Promise<{
  summary: string
  recentMessages: Array<{ role: string; content: string; createdAt?: string }>
  turnsSinceSummary: number
  checkpoints: Array<{ timestamp: string; keywords: string[]; summary: string }>
  sessionCreatedAt: string
}> {
  const msgPK = overrides?.msgPK ?? `USER#${userId}#SESSION#${sessionId}`
  const sessionSK = overrides?.sessionSK ?? `SESSION#${sessionId}`

  // セッションレコード（要約）を取得
  const sessionResult = await dynamo.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: { S: `USER#${userId}` },
      SK: { S: sessionSK },
    },
  }))

  const summary = sessionResult.Item?.summary?.S ?? ''
  const turnsSinceSummary = parseInt(sessionResult.Item?.turnsSinceSummary?.N ?? '0', 10)
  const sessionCreatedAt = sessionResult.Item?.createdAt?.S ?? sessionResult.Item?.updatedAt?.S ?? new Date().toISOString()

  // 直近メッセージとチェックポイントを並列取得
  const [messagesResult, checkpointsResult] = await Promise.all([
    dynamo.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': { S: msgPK },
        ':skPrefix': { S: 'MSG#' },
      },
      ScanIndexForward: false,
      Limit: RECENT_MESSAGES_LIMIT,
    })),
    dynamo.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': { S: msgPK },
        ':skPrefix': { S: 'SUMMARY_CP#' },
      },
      ScanIndexForward: true,
    })),
  ])

  const recentMessages = (messagesResult.Items ?? [])
    .reverse()
    .map((item) => ({
      role: item.role?.S ?? 'user',
      content: item.content?.S ?? '',
      createdAt: item.createdAt?.S,
    }))
    // 同一タイムスタンプで保存された user/assistant の会話順を修正
    // DynamoDB SK 辞書順では #assistant < #user だが、会話順は user → assistant
    .sort((a, b) => {
      const tsA = a.createdAt ?? ''
      const tsB = b.createdAt ?? ''
      if (tsA !== tsB) return tsA.localeCompare(tsB)
      if (a.role === 'user' && b.role === 'assistant') return -1
      if (a.role === 'assistant' && b.role === 'user') return 1
      return 0
    })

  const checkpoints = (checkpointsResult.Items ?? []).map((item) => ({
    timestamp: item.createdAt?.S ?? '',
    keywords: (item.keywords?.L ?? []).map((k) => k.S ?? ''),
    summary: item.summary?.S ?? '',
  }))

  return { summary, recentMessages, turnsSinceSummary, checkpoints, sessionCreatedAt }
}

/**
 * セッションのターンカウントを更新し、必要に応じて要約 Lambda を非同期起動
 */
async function updateSessionAndMaybeSummarize(
  userId: string,
  sessionId: string,
  turnsSinceSummary: number,
  userMessage: string,
  assistantMessage: string,
  overrides?: { msgPK?: string; sessionSK?: string; themeId?: string }
): Promise<void> {
  const nowDate = new Date()
  const now = nowDate.toISOString()
  const ttlExpiry = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
  const msgPK = overrides?.msgPK ?? `USER#${userId}#SESSION#${sessionId}`
  const sessionSK = overrides?.sessionSK ?? `SESSION#${sessionId}`

  // メッセージを DynamoDB に保存（user + assistant）
  // assistant に +1ms オフセットを付与して SK 辞書順で user → assistant の会話順を保証
  const userTimestamp = now
  const assistantTimestamp = new Date(nowDate.getTime() + 1).toISOString()
  const userMsgSK = `MSG#${userTimestamp}#user`
  const assistantMsgSK = `MSG#${assistantTimestamp}#assistant`

  // 並列保存
  await Promise.all([
    dynamo.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: msgPK },
        SK: { S: userMsgSK },
      },
      UpdateExpression: 'SET #role = :role, #content = :content, #ts = :ts, #ttl = :ttl',
      ExpressionAttributeNames: {
        '#role': 'role',
        '#content': 'content',
        '#ts': 'createdAt',
        '#ttl': 'ttlExpiry',
      },
      ExpressionAttributeValues: {
        ':role': { S: 'user' },
        ':content': { S: userMessage },
        ':ts': { S: now },
        ':ttl': { N: String(ttlExpiry) },
      },
    })),
    dynamo.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: msgPK },
        SK: { S: assistantMsgSK },
      },
      UpdateExpression: 'SET #role = :role, #content = :content, #ts = :ts, #ttl = :ttl',
      ExpressionAttributeNames: {
        '#role': 'role',
        '#content': 'content',
        '#ts': 'createdAt',
        '#ttl': 'ttlExpiry',
      },
      ExpressionAttributeValues: {
        ':role': { S: 'assistant' },
        ':content': { S: assistantMessage },
        ':ts': { S: assistantTimestamp },
        ':ttl': { N: String(ttlExpiry) },
      },
    })),
  ])

  const newTurnsSinceSummary = turnsSinceSummary + 1

  // セッションレコードのターンカウントを更新
  await dynamo.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: { S: `USER#${userId}` },
      SK: { S: sessionSK },
    },
    UpdateExpression: 'SET turnsSinceSummary = :tss, updatedAt = :now, ttlExpiry = :ttl, createdAt = if_not_exists(createdAt, :now) ADD totalTurns :one',
    ExpressionAttributeValues: {
      ':tss': { N: String(newTurnsSinceSummary >= SUMMARY_INTERVAL ? 0 : newTurnsSinceSummary) },
      ':now': { S: now },
      ':ttl': { N: String(ttlExpiry) },
      ':one': { N: '1' },
    },
  }))

  // 5ターンに達したら要約 Lambda を非同期起動
  if (newTurnsSinceSummary >= SUMMARY_INTERVAL && SUMMARIZE_FUNCTION_NAME) {
    console.log(`[LLM] ${newTurnsSinceSummary} ターン経過 — 要約 Lambda を非同期起動`)
    try {
      await lambdaClient.send(new InvokeCommand({
        FunctionName: SUMMARIZE_FUNCTION_NAME,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ userId, sessionId, ...(overrides?.themeId ? { themeId: overrides.themeId } : {}) })),
      }))
    } catch (error) {
      console.warn('[LLM] 要約 Lambda 起動エラー（スキップ）:', error)
    }
  }

  // テーマセッションの updatedAt を更新
  if (overrides?.themeId) {
    try {
      await dynamo.send(new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: { S: `USER#${userId}` },
          SK: { S: `THEME_SESSION#${overrides.themeId}` },
        },
        UpdateExpression: 'SET updatedAt = :now',
        ExpressionAttributeValues: {
          ':now': { S: now },
        },
      }))
    } catch (error) {
      console.warn('[LLM] テーマセッション updatedAt 更新エラー（スキップ）:', error)
    }
  }

  // ACTIVE_SESSION レコードを upsert（セッション終了検出用）
  try {
    await dynamo.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: 'ACTIVE_SESSION' },
        SK: { S: overrides?.themeId ? `${userId}#theme:${overrides.themeId}` : `${userId}#${sessionId}` },
      },
      UpdateExpression: `SET userId = :uid, sessionId = :sid, updatedAt = :now, ttlExpiry = :ttl${overrides?.themeId ? ', themeId = :tid' : ''}`,
      ExpressionAttributeValues: {
        ':uid': { S: userId },
        ':sid': { S: sessionId },
        ':now': { S: now },
        ':ttl': { N: String(Math.floor(Date.now() / 1000) + 24 * 60 * 60) },
        ...(overrides?.themeId ? { ':tid': { S: overrides.themeId } } : {}),
      },
    }))
  } catch (error) {
    console.warn('[LLM] ACTIVE_SESSION upsert エラー（スキップ）:', error)
  }
}

/**
 * フロントエンドの会話履歴を Converse API 形式に変換
 */
function toConverseMessages(
  history: Array<{ role: string; content: string; createdAt?: string }>,
  message: string,
  imageBase64?: string,
): BedrockMessage[] {
  const messages: BedrockMessage[] = history.map((m) => {
    // タイムスタンプはユーザーメッセージにのみ付与（assistantに付けるとLLMが応答に含めてしまう）
    const text = m.createdAt && m.role === 'user' ? `[${toJSTDateTimeString(m.createdAt)}] ${m.content}` : m.content
    return {
      role: m.role as 'user' | 'assistant',
      content: [{ text }],
    }
  })

  const userContent: ContentBlock[] = [{ text: message }]
  if (imageBase64) {
    const imageBytes = Buffer.from(imageBase64, 'base64')
    userContent.push({
      image: {
        format: detectImageFormat(imageBytes),
        source: { bytes: imageBytes },
      },
    })
  }

  messages.push({ role: 'user', content: userContent })
  return messages
}

/**
 * Converse API レスポンスからテキストを抽出
 */
function extractTextFromOutput(output: { message?: BedrockMessage }): string {
  const contentBlocks = output.message?.content ?? []
  const textBlocks = contentBlocks
    .filter((block): block is ContentBlock & { text: string } => 'text' in block && typeof block.text === 'string')
    .map((block) => block.text)
  return textBlocks.join('')
}

/**
 * ユーザーの WebSocket 接続 ID を DynamoDB から取得
 */
async function getUserConnectionIds(userId: string): Promise<string[]> {
  try {
    const result = await dynamo.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${userId}` },
        ':sk': { S: 'WS_CONN#' },
      },
    }))
    return (result.Items ?? [])
      .map((item: Record<string, { S?: string }>) => item.connectionId?.S)
      .filter((id: string | undefined): id is string => !!id)
  } catch (error) {
    console.warn('[Stream] WebSocket 接続 ID 取得エラー:', error)
    return []
  }
}

/**
 * WebSocket 接続にメッセージを送信（接続切れは無視）
 */
async function wsPush(wsClient: ApiGatewayManagementApiClient, connectionId: string, data: unknown): Promise<boolean> {
  try {
    await wsClient.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: new TextEncoder().encode(JSON.stringify(data)),
    }))
    return true
  } catch (err: any) {
    if (err.statusCode === 410 || err.name === 'GoneException') {
      await dynamo.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND SK = :sk',
        ExpressionAttributeValues: {
          ':pk': { S: `WS_CONN#${connectionId}` },
          ':sk': { S: 'META' },
        },
      })).catch(() => {})
    }
    console.warn(`[Stream] WebSocket プッシュ失敗 (${connectionId}):`, err.name)
    return false
  }
}

/**
 * 全接続に一斉プッシュ
 */
async function wsPushAll(wsClient: ApiGatewayManagementApiClient, connectionIds: string[], data: unknown): Promise<void> {
  await Promise.allSettled(connectionIds.map((id) => wsPush(wsClient, id, data)))
}

/**
 * ConverseStreamCommand でストリーミング応答を生成し、WebSocket 経由でチャンク送信
 *
 * @returns テキスト全文（セッション保存用）。ツール使用の場合は null（ループ続行）。
 */
async function streamConverseIteration(
  resolvedModelId: string,
  currentMessages: BedrockMessage[],
  system: SystemContentBlock[],
  inferenceConfig: { maxTokens: number; temperature: number },
  toolConfig: ToolConfiguration,
  wsClient: ApiGatewayManagementApiClient,
  connectionIds: string[],
  requestId: string,
): Promise<{
  fullText: string
  stopReason: string
  toolUseBlocks: Array<{ toolUseId: string; name: string; input: Record<string, unknown> }>
  assistantContentBlocks: ContentBlock[]
}> {
  const result = await bedrock.send(new ConverseStreamCommand({
    modelId: resolvedModelId,
    messages: currentMessages,
    system,
    inferenceConfig,
    toolConfig,
  }))

  let fullText = ''
  let stopReason = ''
  const toolUseBlocks: Array<{ toolUseId: string; name: string; input: Record<string, unknown> }> = []
  let currentToolUse: { toolUseId: string; name: string; inputJson: string } | null = null
  const assistantContentBlocks: ContentBlock[] = []

  if (!result.stream) {
    throw new Error('ConverseStreamCommand returned no stream')
  }

  for await (const event of result.stream) {
    // テキストブロック開始
    if (event.contentBlockStart?.start?.toolUse) {
      const tu = event.contentBlockStart.start.toolUse
      currentToolUse = {
        toolUseId: tu.toolUseId ?? '',
        name: tu.name ?? '',
        inputJson: '',
      }
      // ツール開始をクライアントに通知
      await wsPushAll(wsClient, connectionIds, {
        type: 'chat_tool_start',
        requestId,
        tool: currentToolUse.name,
      })
    }

    // テキストデルタ
    if (event.contentBlockDelta?.delta) {
      const delta = event.contentBlockDelta.delta as Record<string, unknown>
      if (typeof delta.text === 'string') {
        fullText += delta.text
        await wsPushAll(wsClient, connectionIds, {
          type: 'chat_delta',
          requestId,
          delta: delta.text,
        })
      }
      // ツール入力デルタ
      if (delta.toolUse && typeof (delta.toolUse as Record<string, unknown>).input === 'string') {
        if (currentToolUse) {
          currentToolUse.inputJson += (delta.toolUse as Record<string, unknown>).input as string
        }
      }
    }

    // ブロック終了
    if (event.contentBlockStop !== undefined) {
      if (currentToolUse) {
        try {
          const input = currentToolUse.inputJson ? JSON.parse(currentToolUse.inputJson) : {}
          toolUseBlocks.push({
            toolUseId: currentToolUse.toolUseId,
            name: currentToolUse.name,
            input,
          })
          // ContentBlock として保持（会話履歴用）
          assistantContentBlocks.push({
            toolUse: {
              toolUseId: currentToolUse.toolUseId,
              name: currentToolUse.name,
              input,
            },
          } as ContentBlock)
        } catch {
          console.warn('[Stream] ツール入力JSON パース失敗:', currentToolUse.inputJson.slice(0, 100))
        }
        currentToolUse = null
      } else if (fullText) {
        assistantContentBlocks.push({ text: fullText } as ContentBlock)
      }
    }

    // メッセージ終了
    if (event.messageStop) {
      stopReason = event.messageStop.stopReason ?? ''
    }
  }

  return { fullText, stopReason, toolUseBlocks, assistantContentBlocks }
}

/**
 * LLM レスポンス（JSON 文字列）から text フィールドを抽出
 *
 * LLM が複数テキストブロック（平文 + JSON）を返した場合に
 * DynamoDB へ保存する内容をクリーンなテキストにする。
 */
function extractTextFieldFromJson(content: string): string {
  try {
    const parsed = JSON.parse(content)
    if (typeof parsed.text === 'string') return parsed.text
  } catch { /* 全体が JSON ではない */ }

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      if (typeof parsed.text === 'string') return parsed.text
    }
  } catch { /* JSON パース失敗 */ }

  // シングルクォートJSON風のフォールバック
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch && jsonMatch[0].includes("'") && !jsonMatch[0].includes('"')) {
      const fixed = jsonMatch[0].replace(/'/g, '"')
      const parsed = JSON.parse(fixed)
      if (typeof parsed.text === 'string') return parsed.text
    }
  } catch { /* シングルクォート変換失敗 */ }

  // フォールバック: 平文テキスト + JSON メタデータが混在する場合
  // 最初のトップレベル JSON オブジェクト以降を除去
  if (!content.trimStart().startsWith('{')) {
    const jsonStart = content.search(/\{[\s]*"/)
    if (jsonStart > 0) {
      return content.slice(0, jsonStart).trim()
    }
  }

  // テキスト内に混入した {"suggestedReplies": ...} を除去
  return stripEmbeddedJsonFragments(content)
}

/**
 * テキスト内に混入した JSON フラグメント（suggestedReplies 等）を除去
 */
function stripEmbeddedJsonFragments(text: string): string {
  return text.replace(/\{[\s\n]*"suggestedReplies"\s*:\s*\[[\s\S]*?\]\s*\}/g, '').trim()
}

/** 永久記憶の型（facts + preferences） */
interface PermanentMemory {
  facts: string[]
  preferences: string[]
}

/**
 * DynamoDB から永久記憶（PERMANENT_FACTS）を取得
 */
async function getPermanentFacts(userId: string): Promise<PermanentMemory> {
  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: 'PERMANENT_FACTS' },
      },
    }))
    const facts = (result.Item?.facts?.L ?? [])
      .map((item) => item.S ?? '')
      .filter(Boolean)
    const preferences = (result.Item?.preferences?.L ?? [])
      .map((item) => item.S ?? '')
      .filter(Boolean)
    return { facts, preferences }
  } catch (error) {
    console.warn('[LLM] 永久記憶取得エラー（スキップ）:', error)
    return { facts: [], preferences: [] }
  }
}

/** 過去セッション要約の日付グループ型 */
interface PastSessionGroup {
  date: string
  label: string
  sessions: string[]
}

/**
 * DynamoDB から過去セッションの要約を取得し、日付ごとにグループ化（直近7日間）
 */
async function getRecentSessionSummaries(
  userId: string,
  currentSessionId: string
): Promise<PastSessionGroup[]> {
  try {
    const result = await dynamo.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${userId}` },
        ':skPrefix': { S: 'SESSION#' },
      },
    }))

    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const todayKey = toJSTDateKey(now.toISOString())
    // 昨日の日付キーを計算
    const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const yesterdayKey = toJSTDateKey(yesterdayDate.toISOString())

    const sessions = (result.Items ?? [])
      .filter((item) => item.SK?.S !== `SESSION#${currentSessionId}`)
      .filter((item) => item.summary?.S)
      .filter((item) => (item.updatedAt?.S ?? '') >= sevenDaysAgo)

    // 日付キーでグループ化（Map で順序保持）
    const groupMap = new Map<string, { createdAt: string; summary: string }[]>()
    for (const item of sessions) {
      const dateSource = item.createdAt?.S ?? item.updatedAt?.S ?? now.toISOString()
      const dateKey = toJSTDateKey(dateSource)
      if (!groupMap.has(dateKey)) {
        groupMap.set(dateKey, [])
      }
      groupMap.get(dateKey)!.push({
        createdAt: dateSource,
        summary: item.summary!.S!,
      })
    }

    // 各日内は createdAt 昇順（時系列順）にソート
    for (const entries of groupMap.values()) {
      entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    }

    // 日付降順でソートして返却
    return Array.from(groupMap.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([dateKey, entries]) => ({
        date: toJSTDateString(entries[0].createdAt),
        label: getJSTDateLabel(dateKey, todayKey, yesterdayKey),
        sessions: entries.map((e) => e.summary),
      }))
  } catch (error) {
    console.warn('[LLM] 過去セッション要約取得エラー（スキップ）:', error)
    return []
  }
}

/**
 * JST の HH:MM 文字列に変換
 */
function toJSTTimeString(isoTimestamp: string): string {
  const date = new Date(isoTimestamp)
  return date.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })
}

/**
 * JST の MM/DD HH:MM 文字列に変換（メッセージ・チェックポイント用）
 */
function toJSTDateTimeString(isoTimestamp: string): string {
  const date = new Date(isoTimestamp)
  const month = String(date.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric' })).padStart(2, '0')
  const day = String(date.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', day: 'numeric' })).padStart(2, '0')
  const time = toJSTTimeString(isoTimestamp)
  return `${month}/${day} ${time}`
}

/**
 * JST の MM/DD 文字列に変換（セッション日付用）
 */
function toJSTDateString(isoTimestamp: string): string {
  const date = new Date(isoTimestamp)
  const month = String(date.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric' })).padStart(2, '0')
  const day = String(date.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', day: 'numeric' })).padStart(2, '0')
  return `${month}/${day}`
}

/**
 * ISO タイムスタンプを JST の YYYY-MM-DD 日付キーに変換（グループ化用）
 */
function toJSTDateKey(isoTimestamp: string): string {
  const date = new Date(isoTimestamp)
  const year = date.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric' }).replace(/[^0-9]/g, '')
  const month = String(date.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric' })).padStart(2, '0')
  const day = String(date.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', day: 'numeric' })).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 曜日ラベル（日〜土） */
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const

/**
 * 日付キーから表示ラベルを生成（今日/昨日/一昨日/MM/DD(曜日)）
 */
function getJSTDateLabel(dateKey: string, todayKey: string, yesterdayKey: string): string {
  if (dateKey === todayKey) return '今日'
  if (dateKey === yesterdayKey) return '昨日'

  // MM/DD(曜日) 形式
  const date = new Date(dateKey + 'T00:00:00+09:00')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const weekday = WEEKDAY_LABELS[date.getDay()]
  return `${month}/${day}(${weekday})`
}

/**
 * DynamoDB からテーマセッション情報を取得
 */
async function getThemeContext(userId: string, themeId: string): Promise<{ themeName: string; category?: string; subcategory?: string; totalTurns?: number; renamedByUser?: boolean } | null> {
  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: `THEME_SESSION#${themeId}` },
      },
    }))
    if (!result.Item) return null
    return {
      themeName: result.Item.themeName?.S ?? '',
      ...(result.Item.category?.S ? { category: result.Item.category.S } : {}),
      ...(result.Item.subcategory?.S ? { subcategory: result.Item.subcategory.S } : {}),
      ...(result.Item.totalTurns?.N ? { totalTurns: parseInt(result.Item.totalTurns.N, 10) } : {}),
      ...(result.Item.renamedByUser?.S === 'true' ? { renamedByUser: true } : {}),
    }
  } catch (error) {
    console.warn('[LLM] テーマコンテキスト取得エラー（スキップ）:', error)
    return null
  }
}

/** MCP接続情報 */
interface MCPConnection {
  serverUrl: string
  themeId: string
  tools: MCPToolDefinition[]
  expiresAt: string
  isExpired: boolean
}

/**
 * DynamoDB から MCP_CONNECTION レコードを取得
 */
async function getMCPConnection(userId: string, themeId: string): Promise<MCPConnection | null> {
  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: `MCP_CONNECTION#${themeId}` },
      },
    }))
    if (!result.Item) return null

    const expiresAt = result.Item.expiresAt?.S ?? ''
    const isExpired = new Date(expiresAt).getTime() < Date.now()
    const toolDefinitions: MCPToolDefinition[] = result.Item.toolDefinitions?.S
      ? JSON.parse(result.Item.toolDefinitions.S)
      : []

    return {
      serverUrl: result.Item.serverUrl?.S ?? '',
      themeId,
      tools: toolDefinitions,
      expiresAt,
      isExpired,
    }
  } catch (error) {
    console.warn('[LLM] MCP接続情報取得エラー（スキップ）:', error)
    return null
  }
}

/**
 * MCP ツール定義を Bedrock Tool 形式に変換（mcp_ プレフィックス付与）
 */
function convertMCPToolToBedrock(mcpTool: MCPToolDefinition): { toolSpec: { name: string; description: string; inputSchema: { json: Record<string, unknown> } } } {
  return {
    toolSpec: {
      name: `mcp_${mcpTool.name}`,
      description: mcpTool.description ?? mcpTool.name,
      inputSchema: {
        json: mcpTool.inputSchema ?? { type: 'object', properties: {} },
      },
    },
  }
}

/**
 * システムプロンプトを SystemContentBlock[] として構築（Prompt Caching 対応）
 *
 * 構造:
 *   [静的プロンプト] → cachePoint → [ユーザー固有] → cachePoint → [動的コンテキスト]
 */
function buildSystemContentBlocks(
  staticPrompt: string,
  userStaticPrompt: string,
  memoryContext: string,
  sessionSummary: string,
  checkpoints: Array<{ timestamp: string; keywords: string[]; summary: string }> = [],
  sessionDate?: string,
  pastSessions?: PastSessionGroup[],
  themeContext?: { themeName: string; category?: string; subcategory?: string; totalTurns?: number; renamedByUser?: boolean },
  workContext?: { tools: Array<{ name: string; description: string }>; expiresAt: string },
  userLocation?: { lat: number; lng: number },
  briefingContext?: string
): SystemContentBlock[] {
  const blocks: SystemContentBlock[] = []

  // ── キャッシュブロック1: 全ユーザー共通の静的プロンプト ──
  blocks.push({ text: staticPrompt })
  blocks.push({ cachePoint: { type: 'default' } })

  // ── キャッシュブロック2: ユーザー固有の半静的プロンプト ──
  if (userStaticPrompt) {
    blocks.push({ text: userStaticPrompt })
    blocks.push({ cachePoint: { type: 'default' } })
  }

  // ── 動的コンテキスト（キャッシュ対象外） ──
  let dynamic = ''

  // 現在日時
  dynamic += `\n\n${buildDateTimePrompt()}`

  // ユーザーの現在地
  if (userLocation) {
    dynamic += `\n\n<user_location>\nユーザーの現在地: 緯度 ${userLocation.lat}, 経度 ${userLocation.lng}\n「近くの〜」と聞かれたら search_places の locationBias にこの座標を使ってください\n</user_location>`
  }

  // AgentCore Memory（中期記憶）
  if (memoryContext) {
    dynamic += `\n\n<user_context>\n${memoryContext}\n</user_context>`
  }

  // 過去セッション要約（日付グループ化）
  if (pastSessions && pastSessions.length > 0) {
    const groups = pastSessions.map((g) => {
      const lines = g.sessions.map((s) => `・${s}`)
      return `【${g.date}（${g.label}）】\n${lines.join('\n')}`
    })
    dynamic += `\n\n<past_sessions>\n過去のセッション要約：\n\n${groups.join('\n\n')}\n</past_sessions>`
  }

  // テーマコンテキスト
  if (themeContext) {
    console.log(`[LLM] themeContext: themeName="${themeContext.themeName}", totalTurns=${themeContext.totalTurns}, renamedByUser=${themeContext.renamedByUser}`)
    const shouldRename = !themeContext.renamedByUser && themeContext.totalTurns === 2
    if (themeContext.themeName === '新規トピック') {
      dynamic += `\n\n<theme_context>\nこれは新しく作成されたトピックです。\nユーザーの最初の発言内容から、このトピックにふさわしい短いタイトル（15文字以内）を考えて、レスポンスJSONの "topicName" フィールドに含めてください。\n</theme_context>`
    } else if (shouldRename) {
      dynamic += `\n\n<theme_context>\nテーマ: ${themeContext.themeName}\nこのセッションでは「${themeContext.themeName}」について会話しています。\nテーマに関連する回答を心がけてください。\n\n【重要】これまでの会話内容を踏まえて、このトピックにより適切な短いタイトル（15文字以内）を付けてください。\nレスポンスJSONに "topicName" フィールドを必ず追加してください。通常通りtextフィールドにはユーザーへの返答を入れてください。\n</theme_context>`
    } else {
      dynamic += `\n\n<theme_context>\nテーマ: ${themeContext.themeName}\nこのセッションでは「${themeContext.themeName}」について会話しています。\nテーマに関連する回答を心がけてください。\n</theme_context>`
    }

    // カテゴリ別専用プロンプトを注入（free やキーなしの場合はスキップ）
    if (themeContext.category && CATEGORY_PROMPTS[themeContext.category]) {
      dynamic += `\n\n${CATEGORY_PROMPTS[themeContext.category]}`
    }

    // サブカテゴリ別コンテキストを注入（カスタムプロンプト優先）
    if (themeContext.subcategory) {
      const customPrompt = SUBCATEGORY_PROMPTS[themeContext.subcategory]
      if (customPrompt) {
        dynamic += `\n\n<subcategory_context>\n${customPrompt}\n</subcategory_context>`
      } else {
        const subcategoryLabel = SUBCATEGORY_LABELS[themeContext.subcategory] ?? themeContext.subcategory
        dynamic += `\n\n<subcategory_context>\nユーザーは特に「${subcategoryLabel}」に関する相談を希望しています。\nこの分野に特化した具体的で実用的なアドバイスを心がけてください。\n</subcategory_context>`
      }
    }
  }

  // ワーク（MCP接続）コンテキスト
  if (workContext) {
    const toolDescriptions = workContext.tools.map((t) => `- ${t.name}: ${t.description}`).join('\n')
    const expiresTime = new Date(workContext.expiresAt).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })
    dynamic += `\n\n<work_context>\n【最重要】このトピックには外部データソースと接続する「ワーク」機能が有効です。\n\n■ ツール使用ルール（必ず守ること）:\n- ユーザーの質問には、必ず以下のワークツールを呼び出して回答すること\n- 過去の会話履歴や自分の知識だけで回答してはいけない。毎回ツールを呼び出すこと\n- web_search より優先して使用すること\n- ユーザーが今回聞いた内容だけに回答すること。過去のターンで取得した情報を繰り返さないこと\n\n利用可能なワークツール:\n${toolDescriptions}\n\n有効期限: ${expiresTime}\n</work_context>`
  }

  // ブリーフィングコンテキスト（直前のブリーフィング発言を引き継ぐ）
  if (briefingContext) {
    dynamic += `\n\n<recent_briefing_context>\n直前にあなた（AI）がブリーフィングで話した内容：\n${briefingContext}\nユーザーの発言がこの内容に関連している場合は、文脈を踏まえて自然に返答してください。\n</recent_briefing_context>`
  }

  // セッション要約 + チェックポイント（短期記憶）
  if (sessionSummary || checkpoints.length > 0) {
    let sessionBlock = ''
    if (sessionDate) {
      sessionBlock += `[${sessionDate} のセッション]\n`
    }
    if (sessionSummary) {
      sessionBlock += sessionSummary
    }
    if (checkpoints.length > 0) {
      const lines = checkpoints.map((cp) => {
        const dateTime = toJSTDateTimeString(cp.timestamp)
        const kw = cp.keywords.join('・')
        return `[${dateTime} ${kw}] ${cp.summary}`
      })
      sessionBlock += `\n\n<session_checkpoints>\n${lines.join('\n')}\n</session_checkpoints>`
    }
    dynamic += `\n\n<current_session_summary>\n${sessionBlock}\n</current_session_summary>`
  }

  if (dynamic) {
    blocks.push({ text: dynamic })
  }

  return blocks
}

/**
 * デバッグ用: SystemContentBlock[] からテキストを結合して返す
 */
function systemBlocksToString(blocks: SystemContentBlock[]): string {
  return blocks
    .filter((b): b is { text: string } => 'text' in b)
    .map((b) => b.text)
    .join('')
}

/**
 * POST /llm/chat — Bedrock Claude でチャット応答を生成（Converse API + Tool Use）
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  if (!event.body) {
    return response(400, { error: 'Request body is required' })
  }

  let message: string
  let history: Array<{ role: string; content: string }>
  let imageBase64: string | undefined
  let sessionId: string | undefined
  let themeId: string | undefined
  let userLocation: { lat: number; lng: number } | undefined
  let modelKey = 'haiku'
  let selectedModelId: string | undefined
  let includeDebug = false
  let streaming = false

  try {
    const body = JSON.parse(event.body)
    message = body.message
    history = body.history ?? []
    // systemPrompt はフロントエンドから受け取らず、バックエンドで生成する
    imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : undefined
    sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
    themeId = typeof body.themeId === 'string' ? body.themeId : undefined

    // modelKey のホワイトリスト検証（不正値はデフォルト haiku）
    if (typeof body.modelKey === 'string' && body.modelKey in MODEL_ID_MAP) {
      modelKey = body.modelKey
    }

    // userLocation のバリデーション
    if (body.userLocation && typeof body.userLocation === 'object'
      && typeof body.userLocation.lat === 'number' && typeof body.userLocation.lng === 'number') {
      userLocation = { lat: body.userLocation.lat, lng: body.userLocation.lng }
    }

    // ユーザーが選択したモデルID
    if (typeof body.selectedModelId === 'string') {
      selectedModelId = body.selectedModelId
    }

    // デバッグ情報の返却フラグ
    if (body.includeDebug === true) {
      includeDebug = true
    }

    // ストリーミングモード
    if (body.streaming === true) {
      streaming = true
    }

    if (!message || typeof message !== 'string') {
      return response(400, { error: 'message is required' })
    }

    if (imageBase64 && imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
      return response(400, { error: '画像サイズが上限（5MB）を超えています' })
    }
  } catch {
    return response(400, { error: 'Invalid JSON' })
  }

  // ブリーフィングモード判定
  const isBriefingMode = message === '__briefing__'
  if (isBriefingMode) {
    console.log('[LLM] ブリーフィングモード開始')
  }

  // lastBriefingContext（ブリーフィング直後の初回発言時に文脈を引き継ぐ）
  let lastBriefingContext: string | undefined
  try {
    const body = JSON.parse(event.body!)
    if (typeof body.lastBriefingContext === 'string' && body.lastBriefingContext.length > 0) {
      lastBriefingContext = body.lastBriefingContext.slice(0, 500)
    }
  } catch { /* パース済みなので到達しないが安全のため */ }

  // メモリ検索 + 永久記憶 + プロフィール取得 + モデルメタ取得（並列、失敗してもチャットは続行）
  const [memoryRecords, permanentMemory, userProfile, modelMeta] = await Promise.all([
    isBriefingMode ? Promise.resolve([]) : retrieveMemoryRecords(userId, message),
    getPermanentFacts(userId),
    getUserProfile(userId),
    selectedModelId ? getModelMeta(selectedModelId) : Promise.resolve(undefined),
  ])

  // 静的システムプロンプト（キャッシュ対象: モデル設定を反映）
  const staticPrompt = buildStaticSystemPrompt(themeId, modelMeta)

  // ユーザー固有の半静的プロンプト（キャッシュ対象: ユーザー単位）
  const userStaticPrompt = buildUserStaticPrompt(userProfile, permanentMemory)

  // 永久記憶と重複する中期記憶を除外してからテキスト整形
  const dedupedRecords = deduplicateRecords(memoryRecords, permanentMemory)
  if (memoryRecords.length !== dedupedRecords.length) {
    console.log(`[LLM] メモリ重複排除: ${memoryRecords.length} → ${dedupedRecords.length} 件`)
  }
  const memoryContext = formatMemoryContext(dedupedRecords)

  // sessionId の有無で分岐: 新フロー vs 既存フロー
  let messages: BedrockMessage[]
  let system: SystemContentBlock[]
  let enhancedSystemPrompt: string  // デバッグ用
  let sessionTurnsSinceSummary = 0
  let sessionSummary = ''
  let themeContext: { themeName: string; category?: string; subcategory?: string; totalTurns?: number; renamedByUser?: boolean } | null = null
  let mcpConn: MCPConnection | null = null

  if (sessionId) {
    // テーマセッションかメインセッションかを判定
    const msgPK = themeId
      ? `USER#${userId}#THEME#${themeId}`
      : `USER#${userId}#SESSION#${sessionId}`
    const sessionRecordSK = themeId
      ? `THEME_SESSION#${themeId}`
      : `SESSION#${sessionId}`

    console.log(`[LLM] セッションモード: sessionId=${sessionId}${themeId ? `, themeId=${themeId}` : ''}`)

    // テーマコンテキストとMCP接続を並列取得（themeId がある場合のみ）
    const [themeCtx, mcpConnResult] = await Promise.all([
      themeId ? getThemeContext(userId, themeId) : Promise.resolve(null),
      themeId ? getMCPConnection(userId, themeId) : Promise.resolve(null),
    ])
    themeContext = themeCtx
    mcpConn = mcpConnResult

    // お題ありトピックでは過去セッション要約・ブリーフィングコンテキストを除外
    // （会話の焦点がブレるのを防止。free / 未設定は従来通り継承）
    const isTopicWithCategory = Boolean(themeContext?.category && themeContext.category !== 'free')

    // 新フロー: DynamoDB からセッションコンテキストを構築（並列取得）
    const [sessionContext, pastSessions] = await Promise.all([
      getSessionContext(userId, sessionId, { msgPK, sessionSK: sessionRecordSK }),
      isTopicWithCategory
        ? Promise.resolve([])
        : getRecentSessionSummaries(userId, sessionId),
    ])
    sessionTurnsSinceSummary = sessionContext.turnsSinceSummary
    sessionSummary = sessionContext.summary

    const sessionDate = toJSTDateString(sessionContext.sessionCreatedAt)

    // ワークコンテキスト（MCP接続が有効な場合）
    const workContext = mcpConn && !mcpConn.isExpired
      ? { tools: mcpConn.tools.map((t) => ({ name: `mcp_${t.name}`, description: t.description })), expiresAt: mcpConn.expiresAt }
      : undefined

    if (mcpConn) {
      console.log(`[LLM] MCP接続: serverUrl=${mcpConn.serverUrl}, expired=${mcpConn.isExpired}, tools=${mcpConn.tools.length}`)
    }

    // お題ありトピックではブリーフィングコンテキストも除外
    const effectiveBriefingContext = isTopicWithCategory ? undefined : lastBriefingContext

    system = buildSystemContentBlocks(
      staticPrompt,
      userStaticPrompt,
      memoryContext,
      sessionSummary,
      sessionContext.checkpoints,
      sessionDate,
      pastSessions,
      themeContext ?? undefined,
      workContext,
      userLocation,
      effectiveBriefingContext
    )
    enhancedSystemPrompt = systemBlocksToString(system)

    if (sessionContext.checkpoints.length > 0) {
      console.log(`[LLM] チェックポイント ${sessionContext.checkpoints.length} 件をプロンプトに注入`)
    }
    if (pastSessions.length > 0) {
      const totalSessions = pastSessions.reduce((sum, g) => sum + g.sessions.length, 0)
      console.log(`[LLM] 過去セッション ${totalSessions} 件（${pastSessions.length} 日分）をプロンプトに注入`)
    }
    if (isTopicWithCategory) {
      console.log(`[LLM] お題ありトピック（category=${themeContext!.category}）: 過去セッション要約・ブリーフィングコンテキストを除外`)
    }
    if (effectiveBriefingContext) {
      console.log(`[LLM] ブリーフィングコンテキスト注入: ${effectiveBriefingContext.length} 文字`)
    }

    // ワーク（MCP）接続時: 会話履歴を含めず現在のメッセージのみで推論（過去のツール結果による汚染を完全防止）
    const skipHistory = Boolean(mcpConn && !mcpConn.isExpired)
    messages = skipHistory
      ? toConverseMessages([], message, imageBase64)
      : toConverseMessages(sessionContext.recentMessages, message, imageBase64)
  } else {
    // 既存フロー: フロントエンドからの history をそのまま使用
    system = buildSystemContentBlocks(
      staticPrompt,
      userStaticPrompt,
      memoryContext,
      '',
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      userLocation,
      lastBriefingContext
    )
    enhancedSystemPrompt = systemBlocksToString(system)
    messages = toConverseMessages(history, message, imageBase64)
  }

  // ── ブリーフィングモード: ツールを事前呼び出し + 記憶コンテキストをプロンプトに注入 ──
  if (isBriefingMode) {
    const briefingParts: string[] = []

    // 中期記憶 + 過去セッション要約を並列取得（ブリーフィングの「記憶クロスオーバー」用）
    const [briefingMemoryRecords, briefingPastSessions, briefingSessionContext] = await Promise.all([
      retrieveMemoryRecords(userId, '最近の会話の話題や気になっていたこと').catch(() => []),
      sessionId ? getRecentSessionSummaries(userId, sessionId).catch(() => []) : Promise.resolve([]),
      sessionId ? getSessionContext(userId, sessionId).catch(() => ({ summary: '', checkpoints: [], recentMessages: [], turnsSinceSummary: 0, totalTurns: 0, sessionCreatedAt: '' })) : Promise.resolve(null),
    ])

    // 中期記憶（重複排除済み）
    const briefingDedupedRecords = deduplicateRecords(briefingMemoryRecords, permanentMemory)
    const briefingMemoryContext = formatMemoryContext(briefingDedupedRecords)
    if (briefingMemoryContext) {
      briefingParts.push(`<recent_conversations>\nユーザーとの最近の会話から覚えていること：\n${briefingMemoryContext}\n</recent_conversations>`)
    }

    // 過去セッション要約
    if (briefingPastSessions.length > 0) {
      const groups = briefingPastSessions.map((g) => {
        const lines = g.sessions.map((s: string) => `・${s}`)
        return `【${g.date}（${g.label}）】\n${lines.join('\n')}`
      })
      briefingParts.push(`<past_sessions>\n直近の会話要約：\n${groups.join('\n\n')}\n</past_sessions>`)
    }

    // 現セッション要約 + チェックポイント
    if (briefingSessionContext) {
      const sessionParts: string[] = []
      if (briefingSessionContext.summary) {
        sessionParts.push(briefingSessionContext.summary)
      }
      if (briefingSessionContext.checkpoints.length > 0) {
        const cpLines = briefingSessionContext.checkpoints.map((cp: { timestamp: string; keywords: string[]; summary: string }) => {
          const kw = cp.keywords.join('・')
          return `[${kw}] ${cp.summary}`
        })
        sessionParts.push(cpLines.join('\n'))
      }
      if (sessionParts.length > 0) {
        briefingParts.push(`<current_session>\n今日の会話：\n${sessionParts.join('\n')}\n</current_session>`)
      }
    }

    // カレンダー取得（失敗しても続行）
    try {
      const now = new Date()
      const jstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
      const todayStart = new Date(jstNow)
      todayStart.setHours(0, 0, 0, 0)
      const tomorrowEnd = new Date(todayStart)
      tomorrowEnd.setDate(tomorrowEnd.getDate() + 2)

      const calendarResult = await executeSkill('list_events', {
        timeMin: todayStart.toISOString(),
        timeMax: tomorrowEnd.toISOString(),
        maxResults: 10,
      }, 'briefing-cal', userId)
      const calText = calendarResult.content?.[0] && 'text' in calendarResult.content[0] ? calendarResult.content[0].text : ''
      if (calText && !calText.includes('エラー') && !calText.includes('未連携')) {
        briefingParts.push(`<calendar>\n${calText}\n</calendar>`)
      }
    } catch (e) {
      console.warn('[Briefing] カレンダー取得スキップ:', e)
    }

    // 天気取得（失敗しても続行）
    try {
      const weatherInput: Record<string, unknown> = {}
      if (userLocation) {
        weatherInput.latitude = userLocation.lat
        weatherInput.longitude = userLocation.lng
      }
      const weatherResult = await executeSkill('get_weather', weatherInput, 'briefing-weather', userId, undefined, userLocation)
      const weatherText = weatherResult.content?.[0] && 'text' in weatherResult.content[0] ? weatherResult.content[0].text : ''
      if (weatherText && !weatherText.includes('失敗') && !weatherText.includes('位置情報が取得できません')) {
        briefingParts.push(`<weather>\n${weatherText}\n</weather>`)
      }
    } catch (e) {
      console.warn('[Briefing] 天気取得スキップ:', e)
    }

    // 永久記憶をブリーフィングコンテキストに追加
    if (permanentMemory.facts.length > 0) {
      briefingParts.push(`<user_facts>\n${permanentMemory.facts.map((f: string) => `- ${f}`).join('\n')}\n</user_facts>`)
    }
    if (permanentMemory.preferences.length > 0) {
      briefingParts.push(`<user_preferences>\n${permanentMemory.preferences.map((p: string) => `- ${p}`).join('\n')}\n</user_preferences>`)
    }

    // 時間帯判定
    const jstHour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })).getHours()
    const timeOfDay = jstHour < 11 ? '朝' : jstHour < 17 ? '昼' : jstHour < 21 ? '夕方' : '夜'

    // ブリーフィング専用のユーザーメッセージを構築
    const briefingUserMessage = `【ブリーフィングモード】
あなたはユーザーの「相棒」です。ユーザーがアプリを開いたので、自然に話しかけてください。
現在の時間帯: ${timeOfDay}

${briefingParts.join('\n\n')}

ルール:
- 単なる「天気と予定の報告」ではなく、過去の会話の文脈を活かした気遣いを入れること
  - 例: 昨日悩んでいた案件がある → 「あの件、どうなった？」と自然に触れる
  - 例: 最近の会話で興味を示した話題 → 「そういえばあの話だけど」と引き継ぐ
- ユーザーがアプリを閉じていた間も考えていたように振る舞うこと（「非同期思考の演出」）
  - ただし実際に調べていない情報を断言してはいけない
  - 「〜調べようか？」「〜気になったんだけど、詳しく見てみる？」と提案に留めること
- suggestedReplies で具体的なアクションを提案すること（例: 「近くのお店を調べて」「今日の予定を詳しく」）
- 全部の情報を詰め込まない。重要なもの1〜2個に絞って自然に伝える
- 予定がなければ天気の話、天気が平穏なら過去の会話の話題、のように臨機応変に
- 過去の会話情報がない場合は、無理に引き継がず時間帯に合った短い挨拶でよい
- 情報がほとんどない場合は、時間帯に合った短い挨拶だけでよい
- キャラクターの口調を守る
- 押し付けがましくならないように。さりげなく自然に
- 通常の JSON レスポンス形式（text, emotion, motion, suggestedReplies）で返すこと`

    // ブリーフィングメッセージで messages を上書き（会話履歴は不要）
    messages = [{ role: 'user', content: [{ text: briefingUserMessage }] }]

    const memorySources = [
      briefingMemoryContext ? '中期記憶' : null,
      briefingPastSessions.length > 0 ? '過去セッション' : null,
      briefingSessionContext?.summary ? '現セッション' : null,
    ].filter(Boolean)
    console.log(`[Briefing] コンテキスト: ${briefingParts.length} 件（カレンダー, 天気, 永久記憶, ${memorySources.join(', ') || 'なし'}）`)
  }

  // MCP ツールを動的注入（接続が有効な場合のみ）
  const mcpTools = mcpConn && !mcpConn.isExpired
    ? mcpConn.tools.map((t) => convertMCPToolToBedrock(t))
    : []

  const toolConfig: ToolConfiguration = {
    tools: [...TOOL_DEFINITIONS, ...MEMO_TOOL_DEFINITIONS, ...mcpTools],
  }

  try {
    let currentMessages = [...messages]

    const resolvedModelId = MODEL_ID_MAP[modelKey] ?? MODEL_ID_MAP.haiku
    const inferenceConf = MODEL_INFERENCE_CONFIG[modelKey] ?? MODEL_INFERENCE_CONFIG.haiku
    const cachePoints = system.filter((b) => 'cachePoint' in b).length
    console.log(`[LLM] モデル: ${modelKey} (${resolvedModelId}), システムブロック: ${system.length} (cachePoint: ${cachePoints})`)

    // ── ストリーミングモード ──
    if (streaming && WEBSOCKET_ENDPOINT && !isBriefingMode) {
      const connectionIds = await getUserConnectionIds(userId)
      if (connectionIds.length > 0) {
        console.log(`[Stream] ストリーミング開始 (接続数: ${connectionIds.length})`)
        const wsClient = new ApiGatewayManagementApiClient({ endpoint: WEBSOCKET_ENDPOINT })
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const streamInferenceConfig = {
          maxTokens: imageBase64 ? inferenceConf.imageMaxTokens : inferenceConf.maxTokens,
          temperature: 0.7,
        }

        let streamedContent = ''

        for (let iteration = 0; iteration < MAX_TOOL_USE_ITERATIONS; iteration++) {
          const streamResult = await streamConverseIteration(
            resolvedModelId,
            currentMessages,
            system,
            streamInferenceConfig,
            toolConfig,
            wsClient,
            connectionIds,
            requestId,
          )

          console.log(`[Stream] Iteration ${iteration}, stopReason: ${streamResult.stopReason}, text: ${streamResult.fullText.length} chars, tools: ${streamResult.toolUseBlocks.length}`)

          if (streamResult.stopReason === 'tool_use' && streamResult.toolUseBlocks.length > 0) {
            // アシスタントメッセージを会話に追加
            currentMessages.push({
              role: 'assistant',
              content: streamResult.assistantContentBlocks,
            })

            // ツール実行
            const toolResults: ToolResultContentBlock[] = []
            for (const block of streamResult.toolUseBlocks) {
              console.log(`[Stream] Tool use: ${block.name}`, JSON.stringify(block.input))
              const toolResult = await executeSkill(block.name, block.input, block.toolUseId, userId, mcpConn ?? undefined, userLocation)
              console.log(`[Stream] Tool result:`, JSON.stringify(toolResult))
              toolResults.push(toolResult)

              // ツール結果をクライアントに通知
              await wsPushAll(wsClient, connectionIds, {
                type: 'chat_tool_result',
                requestId,
                tool: block.name,
              })
            }

            // ツール結果を user ロールで追加
            currentMessages.push({
              role: 'user',
              content: toolResults.map((tr) => ({ toolResult: tr })),
            })
            continue
          }

          // テキスト応答完了
          streamedContent = streamResult.fullText
          break
        }

        // ── 後処理（非ストリーミングと共通）──

        // DynamoDB にはテキスト部分のみ保存
        const textForStorage = extractTextFieldFromJson(streamedContent)

        // セッション更新 + 要約トリガー
        if (sessionId && !isBriefingMode) {
          try {
            const sessionOverrides = themeId
              ? { msgPK: `USER#${userId}#THEME#${themeId}`, sessionSK: `THEME_SESSION#${themeId}`, themeId }
              : undefined
            await updateSessionAndMaybeSummarize(userId, sessionId, sessionTurnsSinceSummary, message, textForStorage, sessionOverrides)
          } catch (error) {
            console.warn('[Stream] セッション更新エラー（スキップ）:', error)
          }
        }

        // トピック自動命名（初回 + 3ターン目再生成）
        let generatedThemeName: string | undefined
        const isNewTopic = themeId && themeContext?.themeName === '新規トピック'
        const shouldRegenerate = themeId && !themeContext?.renamedByUser && themeContext?.totalTurns === 2
        console.log(`[Stream] 命名判定: isNewTopic=${!!isNewTopic}, shouldRegenerate=${!!shouldRegenerate}, totalTurns=${themeContext?.totalTurns}, renamedByUser=${themeContext?.renamedByUser}`)
        if (isNewTopic || shouldRegenerate) {
          try {
            const jsonMatch = streamedContent.match(/\{[\s\S]*\}/)
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0])
              if (typeof parsed.topicName === 'string' && parsed.topicName.trim()) {
                generatedThemeName = parsed.topicName.trim().slice(0, 15)
              }
            }
            // フォールバック（初回のみ。再生成時は LLM が返さなければ変更しない）
            if (!generatedThemeName && isNewTopic) {
              const trimmed = message.trim().replace(/\n/g, ' ')
              generatedThemeName = trimmed.length > 15 ? trimmed.slice(0, 15) + '…' : trimmed
            }
            if (generatedThemeName) {
              await dynamo.send(new UpdateItemCommand({
                TableName: TABLE_NAME,
                Key: { PK: { S: `USER#${userId}` }, SK: { S: `THEME_SESSION#${themeId}` } },
                UpdateExpression: 'SET themeName = :name',
                ExpressionAttributeValues: { ':name': { S: generatedThemeName } },
              }))
              console.log(`[Stream] トピック${shouldRegenerate ? '再' : '自動'}命名: "${generatedThemeName}"`)
            }
          } catch (err) {
            console.warn('[Stream] トピック自動命名エラー（スキップ）:', err)
          }
        }

        // ワーク状態
        const workStatus = mcpConn
          ? { active: !mcpConn.isExpired, expiresAt: mcpConn.expiresAt, toolCount: mcpConn.tools.length }
          : undefined

        // 完了イベントをクライアントにプッシュ（emotion/motion は content から抽出）
        await wsPushAll(wsClient, connectionIds, {
          type: 'chat_complete',
          requestId,
          content: streamedContent,
          ...(includeDebug ? { enhancedSystemPrompt } : {}),
          ...(sessionSummary ? { sessionSummary } : {}),
          ...(permanentMemory.facts.length > 0 ? { permanentFacts: permanentMemory.facts } : {}),
          ...(permanentMemory.preferences.length > 0 ? { permanentPreferences: permanentMemory.preferences } : {}),
          ...(generatedThemeName ? { themeName: generatedThemeName } : {}),
          ...(workStatus ? { workStatus } : {}),
        })

        console.log(`[Stream] ストリーミング完了 (${streamedContent.length} chars)`)

        // REST レスポンス（ストリーミング済みを示す）
        return response(200, { streamed: true, requestId })
      } else {
        console.log('[Stream] WebSocket 接続なし、非ストリーミングにフォールバック')
      }
    }

    for (let iteration = 0; iteration < MAX_TOOL_USE_ITERATIONS; iteration++) {
      const result = await bedrock.send(new ConverseCommand({
        modelId: resolvedModelId,
        messages: currentMessages,
        system,
        inferenceConfig: {
          maxTokens: imageBase64 ? inferenceConf.imageMaxTokens : inferenceConf.maxTokens,
          temperature: 0.7,
        },
        toolConfig,
      }))

      const stopReason = result.stopReason
      console.log(`[LLM] Iteration ${iteration}, stopReason: ${stopReason}`)

      if (stopReason === 'tool_use') {
        // ツール使用リクエストを処理
        const assistantMessage = result.output?.message
        if (!assistantMessage) {
          return response(500, { error: 'No assistant message in tool_use response' })
        }

        // アシスタントメッセージを会話に追加
        currentMessages.push(assistantMessage)

        // ツール呼び出しを抽出（SDK バージョン互換対応）
        const assistantContent = assistantMessage.content ?? []
        console.log(`[LLM] Assistant content block keys:`, JSON.stringify(assistantContent.map((b: Record<string, unknown>) => Object.keys(b))))
        const toolUseBlocks: Array<{ toolUseId: string; name: string; input: Record<string, unknown> }> = []
        for (const block of assistantContent) {
          const b = block as Record<string, unknown>
          const toolUse = b.toolUse as Record<string, unknown> | undefined
          if (toolUse && typeof toolUse === 'object' && toolUse.toolUseId) {
            toolUseBlocks.push({
              toolUseId: toolUse.toolUseId as string,
              name: toolUse.name as string,
              input: (toolUse.input ?? {}) as Record<string, unknown>,
            })
          }
        }

        if (toolUseBlocks.length === 0) {
          // SDK の ContentBlock 構造が想定外 — デバッグ用にフル出力
          console.error(`[LLM] stopReason=tool_use だがツールブロック未検出。Content:`, JSON.stringify(assistantContent))
          // テキスト応答があればそれを返す、なければエラーメッセージ
          const fallbackText = assistantContent
            .map((b: Record<string, unknown>) => (typeof b === 'object' && 'text' in b && typeof b.text === 'string') ? b.text : '')
            .filter(Boolean)
            .join('')
          return response(200, { content: fallbackText || 'ツールの実行に失敗しました。もう一度お試しください。' })
        }

        const toolResults: ToolResultContentBlock[] = []
        for (const block of toolUseBlocks) {
          const { toolUseId, name, input } = block
          console.log(`[LLM] Tool use: ${name}`, JSON.stringify(input))
          const toolResult = await executeSkill(name, input, toolUseId, userId, mcpConn ?? undefined, userLocation)
          console.log(`[LLM] Tool result:`, JSON.stringify(toolResult))
          toolResults.push(toolResult)
        }

        // ツール結果を user ロールで追加
        currentMessages.push({
          role: 'user',
          content: toolResults.map((tr) => ({ toolResult: tr })),
        })

        continue
      }

      // ツール使用でない場合（end_turn 等）→ テキスト応答を返却
      const content = extractTextFromOutput(result.output ?? {})
      console.log(`[LLM] Final response (${content.length} chars):`, content.slice(0, 500))

      // DynamoDB にはテキスト部分のみ保存（JSON 構造体を除去）
      const textForStorage = extractTextFieldFromJson(content)

      // セッションモードの場合: メッセージ保存 + 要約トリガー（ブリーフィングは保存しない）
      if (sessionId && !isBriefingMode) {
        try {
          const sessionOverrides = themeId
            ? { msgPK: `USER#${userId}#THEME#${themeId}`, sessionSK: `THEME_SESSION#${themeId}`, themeId }
            : undefined
          await updateSessionAndMaybeSummarize(
            userId,
            sessionId,
            sessionTurnsSinceSummary,
            message,
            textForStorage,
            sessionOverrides
          )
        } catch (error) {
          console.warn('[LLM] セッション更新エラー（スキップ）:', error)
        }
      }

      // トピック自動命名（初回 + 3ターン目再生成）
      let generatedThemeName: string | undefined
      const isNewTopic = themeId && themeContext?.themeName === '新規トピック'
      const shouldRegenerate = themeId && !themeContext?.renamedByUser && themeContext?.totalTurns === 2
      if (isNewTopic || shouldRegenerate) {
        try {
          // 1. LLM レスポンスの topicName を試行
          const jsonMatch = content.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0])
            if (typeof parsed.topicName === 'string' && parsed.topicName.trim()) {
              generatedThemeName = parsed.topicName.trim().slice(0, 15)
            }
          }
          // 2. フォールバック: ユーザーメッセージから生成（初回のみ。再生成時は LLM が返さなければ変更しない）
          if (!generatedThemeName && isNewTopic) {
            const trimmed = message.trim().replace(/\n/g, ' ')
            generatedThemeName = trimmed.length > 15
              ? trimmed.slice(0, 15) + '…'
              : trimmed
          }
          if (generatedThemeName) {
            console.log(`[LLM] トピック${shouldRegenerate ? '再' : '自動'}命名: "${generatedThemeName}"`)
            await dynamo.send(new UpdateItemCommand({
              TableName: TABLE_NAME,
              Key: {
                PK: { S: `USER#${userId}` },
                SK: { S: `THEME_SESSION#${themeId}` },
              },
              UpdateExpression: 'SET themeName = :name',
              ExpressionAttributeValues: {
                ':name': { S: generatedThemeName },
              },
            }))
          }
        } catch (err) {
          console.warn('[LLM] トピック自動命名エラー（スキップ）:', err)
        }
      }

      // ワーク状態をレスポンスに含める
      const workStatus = mcpConn
        ? { active: !mcpConn.isExpired, expiresAt: mcpConn.expiresAt, toolCount: mcpConn.tools.length }
        : undefined

      return response(200, {
        content,
        ...(includeDebug ? { enhancedSystemPrompt } : {}),
        ...(sessionSummary ? { sessionSummary } : {}),
        ...(permanentMemory.facts.length > 0 ? { permanentFacts: permanentMemory.facts } : {}),
        ...(permanentMemory.preferences.length > 0 ? { permanentPreferences: permanentMemory.preferences } : {}),
        ...(generatedThemeName ? { themeName: generatedThemeName } : {}),
        ...(workStatus ? { workStatus } : {}),
      })
    }

    // 最大ループ回数に到達
    return response(200, { content: 'ツール実行の上限に達しました。もう一度お試しください。' })
  } catch (error) {
    console.error('Bedrock 呼び出しエラー:', error)
    return response(500, { error: 'LLM invocation failed' })
  }
}

function response(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  }
}
