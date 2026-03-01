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
 * AgentCore Memory からユーザーに関する記憶を検索
 *
 * 失敗時は空文字を返し、チャット機能を壊さない。
 */
async function retrieveMemories(userId: string, query: string): Promise<string> {
  if (!MEMORY_ID) {
    return ''
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

    const records = result.memoryRecordSummaries ?? []
    if (records.length === 0) {
      return ''
    }

    const memoryLines = records
      .map((record) => record.content?.text)
      .filter(Boolean)
      .map((text) => `- ${text}`)
      .join('\n')

    if (!memoryLines) {
      return ''
    }

    return `\nあなたが過去の会話から覚えていること：\n${memoryLines}`
  } catch (error) {
    console.warn('[Memory] メモリ検索エラー（スキップ）:', error)
    return ''
  }
}

/**
 * DynamoDB からセッションコンテキスト（要約 + 直近メッセージ）を取得
 */
async function getSessionContext(userId: string, sessionId: string): Promise<{
  summary: string
  recentMessages: Array<{ role: string; content: string }>
  turnsSinceSummary: number
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

  // 直近メッセージを取得（新しい順 → 逆順にして返す）
  const messagesResult = await dynamo.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': { S: `USER#${userId}#SESSION#${sessionId}` },
      ':skPrefix': { S: 'MSG#' },
    },
    ScanIndexForward: false,
    Limit: RECENT_MESSAGES_LIMIT,
  }))

  const recentMessages = (messagesResult.Items ?? [])
    .reverse()
    .map((item) => ({
      role: item.role?.S ?? 'user',
      content: item.content?.S ?? '',
    }))

  return { summary, recentMessages, turnsSinceSummary }
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
 * システムプロンプトを構築（メモリ + セッション要約を注入）
 */
function buildEnhancedSystemPrompt(
  systemPrompt: string,
  memoryContext: string,
  sessionSummary: string
): string {
  let enhanced = systemPrompt

  if (memoryContext) {
    enhanced += `\n\n<user_context>\n${memoryContext}\n</user_context>`
  }

  if (sessionSummary) {
    enhanced += `\n\n<current_session_summary>\n${sessionSummary}\n</current_session_summary>`
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

  // メモリ検索（失敗してもチャットは続行）
  const memoryContext = await retrieveMemories(userId, message)

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
      memoryContext,
      sessionSummary
    )

    // セッションの直近メッセージ + 今回のメッセージで会話構築
    messages = toConverseMessages(sessionContext.recentMessages, message, imageBase64)
  } else {
    // 既存フロー: フロントエンドからの history をそのまま使用
    enhancedSystemPrompt = systemPrompt + memoryContext
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
