import {
  BedrockRuntimeClient,
  ConverseCommand,
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
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { executeSkill } from './skills'
import { TOOL_DEFINITIONS } from './skills/toolDefinitions'
import type { MCPToolDefinition } from '../mcp/mcpClient'

const bedrock = new BedrockRuntimeClient({})
const agentCore = new BedrockAgentCoreClient({})
const dynamo = new DynamoDBClient({})
const lambdaClient = new LambdaClient({})

const MEMORY_ID = process.env.MEMORY_ID ?? ''
const TABLE_NAME = process.env.TABLE_NAME ?? ''
const SUMMARIZE_FUNCTION_NAME = process.env.SUMMARIZE_FUNCTION_NAME ?? ''
const MAX_TOOL_USE_ITERATIONS = 5

/** モデルキーから Bedrock 推論プロファイル ID へのマッピング */
const MODEL_ID_MAP: Record<string, string> = {
  haiku: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0',
  sonnet: 'jp.anthropic.claude-sonnet-4-6',
  opus: 'global.anthropic.claude-opus-4-6-v1',
}

/** モデルキーごとの推論設定 */
const MODEL_INFERENCE_CONFIG: Record<string, { maxTokens: number; imageMaxTokens: number }> = {
  haiku: { maxTokens: 1024, imageMaxTokens: 2048 },
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
function deduplicateRecords(memoryRecords: string[], permanentFacts: string[]): string[] {
  if (permanentFacts.length === 0) return memoryRecords

  const normalizedFacts = permanentFacts.map((f) => f.replace(/\s+/g, ''))

  return memoryRecords.filter((record) => {
    const normalizedRecord = record.replace(/\s+/g, '')
    return !normalizedFacts.some((fact) =>
      normalizedRecord.includes(fact) || fact.includes(normalizedRecord)
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
  const now = new Date().toISOString()
  const ttlExpiry = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
  const msgPK = overrides?.msgPK ?? `USER#${userId}#SESSION#${sessionId}`
  const sessionSK = overrides?.sessionSK ?? `SESSION#${sessionId}`

  // メッセージを DynamoDB に保存（user + assistant）
  const msgTimestamp = now
  const userMsgSK = `MSG#${msgTimestamp}#user`
  const assistantMsgSK = `MSG#${msgTimestamp}#assistant`

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
        ':ts': { S: now },
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
  imageBase64?: string
): BedrockMessage[] {
  const messages: BedrockMessage[] = history.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: [{ text: m.createdAt ? `[${toJSTDateTimeString(m.createdAt)}] ${m.content}` : m.content }],
  }))

  const userContent: ContentBlock[] = [{ text: message }]
  if (imageBase64) {
    userContent.push({
      image: {
        format: 'jpeg',
        source: { bytes: Buffer.from(imageBase64, 'base64') },
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

  // フォールバック: 末尾の {"text" パターンを除去
  const idx = content.indexOf('{"text"')
  if (idx > 0) {
    return content.slice(0, idx).trim()
  }

  return content
}

/**
 * DynamoDB から永久記憶（PERMANENT_FACTS）を取得
 */
async function getPermanentFacts(userId: string): Promise<string[]> {
  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: 'PERMANENT_FACTS' },
      },
    }))
    return (result.Item?.facts?.L ?? [])
      .map((item) => item.S ?? '')
      .filter(Boolean)
  } catch (error) {
    console.warn('[LLM] 永久記憶取得エラー（スキップ）:', error)
    return []
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
async function getThemeContext(userId: string, themeId: string): Promise<{ themeName: string; category?: string; subcategory?: string } | null> {
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
 * システムプロンプトを構築（永久記憶 + メモリ + セッション要約 + チェックポイントを注入）
 */
function buildEnhancedSystemPrompt(
  systemPrompt: string,
  permanentFacts: string[],
  memoryContext: string,
  sessionSummary: string,
  checkpoints: Array<{ timestamp: string; keywords: string[]; summary: string }> = [],
  sessionDate?: string,
  pastSessions?: PastSessionGroup[],
  themeContext?: { themeName: string; category?: string; subcategory?: string },
  workContext?: { tools: Array<{ name: string; description: string }>; expiresAt: string },
  userLocation?: { lat: number; lng: number }
): string {
  let enhanced = systemPrompt

  // ユーザーの現在地
  if (userLocation) {
    enhanced += `\n\n<user_location>\nユーザーの現在地: 緯度 ${userLocation.lat}, 経度 ${userLocation.lng}\n「近くの〜」と聞かれたら search_places の locationBias にこの座標を使ってください\n</user_location>`
  }

  // 永久記憶（最優先）
  if (permanentFacts.length > 0) {
    const factsText = permanentFacts.map((f) => `- ${f}`).join('\n')
    enhanced += `\n\n<permanent_profile>\nユーザーについて知っている事実：\n${factsText}\n</permanent_profile>`
  }

  // AgentCore Memory（中期記憶）
  if (memoryContext) {
    enhanced += `\n\n<user_context>\n${memoryContext}\n</user_context>`
  }

  // 過去セッション要約（日付グループ化）
  if (pastSessions && pastSessions.length > 0) {
    const groups = pastSessions.map((g) => {
      const lines = g.sessions.map((s) => `・${s}`)
      return `【${g.date}（${g.label}）】\n${lines.join('\n')}`
    })
    enhanced += `\n\n<past_sessions>\n過去のセッション要約：\n\n${groups.join('\n\n')}\n</past_sessions>`
  }

  // テーマコンテキスト
  if (themeContext) {
    if (themeContext.themeName === '新規トピック') {
      enhanced += `\n\n<theme_context>\nこれは新しく作成されたトピックです。\nユーザーの最初の発言内容から、このトピックにふさわしい短いタイトル（15文字以内）を考えて、レスポンスJSONの "topicName" フィールドに含めてください。\n</theme_context>`
    } else {
      enhanced += `\n\n<theme_context>\nテーマ: ${themeContext.themeName}\nこのセッションでは「${themeContext.themeName}」について会話しています。\nテーマに関連する回答を心がけてください。\n</theme_context>`
    }

    // カテゴリ別専用プロンプトを注入（free やキーなしの場合はスキップ）
    if (themeContext.category && CATEGORY_PROMPTS[themeContext.category]) {
      enhanced += `\n\n${CATEGORY_PROMPTS[themeContext.category]}`
    }

    // サブカテゴリ別コンテキストを注入（カスタムプロンプト優先）
    if (themeContext.subcategory) {
      const customPrompt = SUBCATEGORY_PROMPTS[themeContext.subcategory]
      if (customPrompt) {
        enhanced += `\n\n<subcategory_context>\n${customPrompt}\n</subcategory_context>`
      } else {
        const subcategoryLabel = SUBCATEGORY_LABELS[themeContext.subcategory] ?? themeContext.subcategory
        enhanced += `\n\n<subcategory_context>\nユーザーは特に「${subcategoryLabel}」に関する相談を希望しています。\nこの分野に特化した具体的で実用的なアドバイスを心がけてください。\n</subcategory_context>`
      }
    }
  }

  // ワーク（MCP接続）コンテキスト
  if (workContext) {
    const toolDescriptions = workContext.tools.map((t) => `- ${t.name}: ${t.description}`).join('\n')
    const expiresTime = new Date(workContext.expiresAt).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })
    enhanced += `\n\n<work_context>\n【重要】このトピックには外部データソースと接続する「ワーク」機能が有効です。\nユーザーの質問には、まず以下のワークツールを使って回答してください。web_search より優先して使用すること。\n\n利用可能なワークツール:\n${toolDescriptions}\n\n有効期限: ${expiresTime}\n</work_context>`
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
    enhanced += `\n\n<current_session_summary>\n${sessionBlock}\n</current_session_summary>`
  }

  return enhanced
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
  let systemPrompt: string
  let imageBase64: string | undefined
  let sessionId: string | undefined
  let themeId: string | undefined
  let userLocation: { lat: number; lng: number } | undefined
  let modelKey = 'haiku'

  try {
    const body = JSON.parse(event.body)
    message = body.message
    history = body.history ?? []
    systemPrompt = body.systemPrompt ?? ''
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

    if (!message || typeof message !== 'string') {
      return response(400, { error: 'message is required' })
    }

    if (imageBase64 && imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
      return response(400, { error: '画像サイズが上限（5MB）を超えています' })
    }
  } catch {
    return response(400, { error: 'Invalid JSON' })
  }

  // メモリ検索 + 永久記憶取得（並列、失敗してもチャットは続行）
  const [memoryRecords, permanentFacts] = await Promise.all([
    retrieveMemoryRecords(userId, message),
    getPermanentFacts(userId),
  ])

  // 永久記憶と重複する中期記憶を除外してからテキスト整形
  const dedupedRecords = deduplicateRecords(memoryRecords, permanentFacts)
  if (memoryRecords.length !== dedupedRecords.length) {
    console.log(`[LLM] メモリ重複排除: ${memoryRecords.length} → ${dedupedRecords.length} 件`)
  }
  const memoryContext = formatMemoryContext(dedupedRecords)

  // sessionId の有無で分岐: 新フロー vs 既存フロー
  let messages: BedrockMessage[]
  let enhancedSystemPrompt: string
  let sessionTurnsSinceSummary = 0
  let sessionSummary = ''
  let themeContext: { themeName: string; category?: string; subcategory?: string } | null = null
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

    // 新フロー: DynamoDB からセッションコンテキストを構築（並列取得）
    const [sessionContext, pastSessions] = await Promise.all([
      getSessionContext(userId, sessionId, { msgPK, sessionSK: sessionRecordSK }),
      getRecentSessionSummaries(userId, sessionId),
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

    enhancedSystemPrompt = buildEnhancedSystemPrompt(
      systemPrompt,
      permanentFacts,
      memoryContext,
      sessionSummary,
      sessionContext.checkpoints,
      sessionDate,
      pastSessions,
      themeContext ?? undefined,
      workContext,
      userLocation
    )

    if (sessionContext.checkpoints.length > 0) {
      console.log(`[LLM] チェックポイント ${sessionContext.checkpoints.length} 件をプロンプトに注入`)
    }
    if (pastSessions.length > 0) {
      const totalSessions = pastSessions.reduce((sum, g) => sum + g.sessions.length, 0)
      console.log(`[LLM] 過去セッション ${totalSessions} 件（${pastSessions.length} 日分）をプロンプトに注入`)
    }

    // セッションの直近メッセージ + 今回のメッセージで会話構築
    messages = toConverseMessages(sessionContext.recentMessages, message, imageBase64)
  } else {
    // 既存フロー: フロントエンドからの history をそのまま使用
    enhancedSystemPrompt = buildEnhancedSystemPrompt(
      systemPrompt,
      permanentFacts,
      memoryContext,
      '',
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      userLocation
    )
    messages = toConverseMessages(history, message, imageBase64)
  }

  const system: SystemContentBlock[] = enhancedSystemPrompt
    ? [{ text: enhancedSystemPrompt }]
    : []

  // MCP ツールを動的注入（接続が有効な場合のみ）
  const mcpTools = mcpConn && !mcpConn.isExpired
    ? mcpConn.tools.map((t) => convertMCPToolToBedrock(t))
    : []

  const toolConfig: ToolConfiguration = {
    tools: [...TOOL_DEFINITIONS, ...mcpTools],
  }

  try {
    let currentMessages = [...messages]

    const resolvedModelId = MODEL_ID_MAP[modelKey] ?? MODEL_ID_MAP.haiku
    const inferenceConf = MODEL_INFERENCE_CONFIG[modelKey] ?? MODEL_INFERENCE_CONFIG.haiku
    console.log(`[LLM] モデル: ${modelKey} (${resolvedModelId})`)

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
      console.log(`[LLM] Final response (${content.length} chars):`, content.slice(0, 200))

      // DynamoDB にはテキスト部分のみ保存（JSON 構造体を除去）
      const textForStorage = extractTextFieldFromJson(content)

      // セッションモードの場合: メッセージ保存 + 要約トリガー
      if (sessionId) {
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

      // 新規トピックの自動命名
      let generatedThemeName: string | undefined
      if (themeId && themeContext?.themeName === '新規トピック') {
        try {
          // 1. LLM レスポンスの topicName を試行
          const jsonMatch = content.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0])
            if (typeof parsed.topicName === 'string' && parsed.topicName.trim()) {
              generatedThemeName = parsed.topicName.trim().slice(0, 15)
            }
          }
          // 2. フォールバック: ユーザーメッセージから生成
          if (!generatedThemeName) {
            const trimmed = message.trim().replace(/\n/g, ' ')
            generatedThemeName = trimmed.length > 15
              ? trimmed.slice(0, 15) + '…'
              : trimmed
          }
          console.log(`[LLM] トピック自動命名: "${generatedThemeName}"`)
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
        enhancedSystemPrompt,
        ...(sessionSummary ? { sessionSummary } : {}),
        ...(permanentFacts.length > 0 ? { permanentFacts } : {}),
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
