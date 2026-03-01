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

const bedrock = new BedrockRuntimeClient({})
const agentCore = new BedrockAgentCoreClient({})
const dynamo = new DynamoDBClient({})
const lambdaClient = new LambdaClient({})

const MEMORY_ID = process.env.MEMORY_ID ?? ''
const TABLE_NAME = process.env.TABLE_NAME ?? ''
const SUMMARIZE_FUNCTION_NAME = process.env.SUMMARIZE_FUNCTION_NAME ?? ''
const MAX_TOOL_USE_ITERATIONS = 5
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
async function getSessionContext(userId: string, sessionId: string): Promise<{
  summary: string
  recentMessages: Array<{ role: string; content: string }>
  turnsSinceSummary: number
  checkpoints: Array<{ timestamp: string; keywords: string[]; summary: string }>
}> {
  // セッションレコード（要約）を取得
  const sessionResult = await dynamo.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: { S: `USER#${userId}` },
      SK: { S: `SESSION#${sessionId}` },
    },
  }))

  const summary = sessionResult.Item?.summary?.S ?? ''
  const turnsSinceSummary = parseInt(sessionResult.Item?.turnsSinceSummary?.N ?? '0', 10)

  // 直近メッセージとチェックポイントを並列取得
  const [messagesResult, checkpointsResult] = await Promise.all([
    dynamo.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${userId}#SESSION#${sessionId}` },
        ':skPrefix': { S: 'MSG#' },
      },
      ScanIndexForward: false,
      Limit: RECENT_MESSAGES_LIMIT,
    })),
    dynamo.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${userId}#SESSION#${sessionId}` },
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
    }))

  const checkpoints = (checkpointsResult.Items ?? []).map((item) => ({
    timestamp: item.createdAt?.S ?? '',
    keywords: (item.keywords?.L ?? []).map((k) => k.S ?? ''),
    summary: item.summary?.S ?? '',
  }))

  return { summary, recentMessages, turnsSinceSummary, checkpoints }
}

/**
 * セッションのターンカウントを更新し、必要に応じて要約 Lambda を非同期起動
 */
async function updateSessionAndMaybeSummarize(
  userId: string,
  sessionId: string,
  turnsSinceSummary: number,
  userMessage: string,
  assistantMessage: string
): Promise<void> {
  const now = new Date().toISOString()
  const ttlExpiry = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60

  // メッセージを DynamoDB に保存（user + assistant）
  const msgTimestamp = now
  const userMsgSK = `MSG#${msgTimestamp}#user`
  const assistantMsgSK = `MSG#${msgTimestamp}#assistant`

  // 並列保存
  await Promise.all([
    dynamo.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `USER#${userId}#SESSION#${sessionId}` },
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
        PK: { S: `USER#${userId}#SESSION#${sessionId}` },
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
      SK: { S: `SESSION#${sessionId}` },
    },
    UpdateExpression: 'SET turnsSinceSummary = :tss, updatedAt = :now, ttlExpiry = :ttl ADD totalTurns :one',
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
        Payload: Buffer.from(JSON.stringify({ userId, sessionId })),
      }))
    } catch (error) {
      console.warn('[LLM] 要約 Lambda 起動エラー（スキップ）:', error)
    }
  }

  // ACTIVE_SESSION レコードを upsert（セッション終了検出用）
  try {
    await dynamo.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: 'ACTIVE_SESSION' },
        SK: { S: `${userId}#${sessionId}` },
      },
      UpdateExpression: 'SET userId = :uid, sessionId = :sid, updatedAt = :now, ttlExpiry = :ttl',
      ExpressionAttributeValues: {
        ':uid': { S: userId },
        ':sid': { S: sessionId },
        ':now': { S: now },
        ':ttl': { N: String(Math.floor(Date.now() / 1000) + 24 * 60 * 60) },
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
  history: Array<{ role: string; content: string }>,
  message: string,
  imageBase64?: string
): BedrockMessage[] {
  const messages: BedrockMessage[] = history.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: [{ text: m.content }],
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

/**
 * JST の HH:MM 文字列に変換
 */
function toJSTTimeString(isoTimestamp: string): string {
  const date = new Date(isoTimestamp)
  return date.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })
}

/**
 * システムプロンプトを構築（永久記憶 + メモリ + セッション要約 + チェックポイントを注入）
 */
function buildEnhancedSystemPrompt(
  systemPrompt: string,
  permanentFacts: string[],
  memoryContext: string,
  sessionSummary: string,
  checkpoints: Array<{ timestamp: string; keywords: string[]; summary: string }> = []
): string {
  let enhanced = systemPrompt

  // 永久記憶（最優先）
  if (permanentFacts.length > 0) {
    const factsText = permanentFacts.map((f) => `- ${f}`).join('\n')
    enhanced += `\n\n<permanent_profile>\nユーザーについて知っている事実：\n${factsText}\n</permanent_profile>`
  }

  // AgentCore Memory（中期記憶）
  if (memoryContext) {
    enhanced += `\n\n<user_context>\n${memoryContext}\n</user_context>`
  }

  // セッション要約 + チェックポイント（短期記憶）
  if (sessionSummary || checkpoints.length > 0) {
    let sessionBlock = ''
    if (sessionSummary) {
      sessionBlock += sessionSummary
    }
    if (checkpoints.length > 0) {
      const lines = checkpoints.map((cp) => {
        const time = toJSTTimeString(cp.timestamp)
        const kw = cp.keywords.join('・')
        return `[${time} ${kw}] ${cp.summary}`
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

  try {
    const body = JSON.parse(event.body)
    message = body.message
    history = body.history ?? []
    systemPrompt = body.systemPrompt ?? ''
    imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : undefined
    sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined

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

  if (sessionId) {
    // 新フロー: DynamoDB からセッションコンテキストを構築
    console.log(`[LLM] セッションモード: sessionId=${sessionId}`)
    const sessionContext = await getSessionContext(userId, sessionId)
    sessionTurnsSinceSummary = sessionContext.turnsSinceSummary
    sessionSummary = sessionContext.summary

    enhancedSystemPrompt = buildEnhancedSystemPrompt(
      systemPrompt,
      permanentFacts,
      memoryContext,
      sessionSummary,
      sessionContext.checkpoints
    )

    if (sessionContext.checkpoints.length > 0) {
      console.log(`[LLM] チェックポイント ${sessionContext.checkpoints.length} 件をプロンプトに注入`)
    }

    // セッションの直近メッセージ + 今回のメッセージで会話構築
    messages = toConverseMessages(sessionContext.recentMessages, message, imageBase64)
  } else {
    // 既存フロー: フロントエンドからの history をそのまま使用
    enhancedSystemPrompt = buildEnhancedSystemPrompt(
      systemPrompt,
      permanentFacts,
      memoryContext,
      ''
    )
    messages = toConverseMessages(history, message, imageBase64)
  }

  const system: SystemContentBlock[] = enhancedSystemPrompt
    ? [{ text: enhancedSystemPrompt }]
    : []

  const toolConfig: ToolConfiguration = {
    tools: TOOL_DEFINITIONS,
  }

  try {
    let currentMessages = [...messages]

    for (let iteration = 0; iteration < MAX_TOOL_USE_ITERATIONS; iteration++) {
      const result = await bedrock.send(new ConverseCommand({
        modelId: 'jp.anthropic.claude-sonnet-4-6',
        messages: currentMessages,
        system,
        inferenceConfig: {
          maxTokens: imageBase64 ? 2048 : 1024,
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

        // ツール呼び出しを抽出・実行
        const toolUseBlocks = (assistantMessage.content ?? [])
          .filter((block): block is ContentBlock & { toolUse: { toolUseId: string; name: string; input: Record<string, unknown> } } =>
            'toolUse' in block && block.toolUse !== undefined
          )

        const toolResults: ToolResultContentBlock[] = []
        for (const block of toolUseBlocks) {
          const { toolUseId, name, input } = block.toolUse
          console.log(`[LLM] Tool use: ${name}`, JSON.stringify(input))
          const toolResult = await executeSkill(name, input, toolUseId, userId)
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

      // セッションモードの場合: メッセージ保存 + 要約トリガー
      if (sessionId) {
        try {
          await updateSessionAndMaybeSummarize(
            userId,
            sessionId,
            sessionTurnsSinceSummary,
            message,
            content
          )
        } catch (error) {
          console.warn('[LLM] セッション更新エラー（スキップ）:', error)
        }
      }

      return response(200, {
        content,
        ...(sessionSummary ? { sessionSummary } : {}),
        ...(permanentFacts.length > 0 ? { permanentFacts } : {}),
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
