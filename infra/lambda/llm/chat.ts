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
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { executeSkill } from './skills'
import { TOOL_DEFINITIONS } from './skills/toolDefinitions'

const bedrock = new BedrockRuntimeClient({})
const agentCore = new BedrockAgentCoreClient({})

const MEMORY_ID = process.env.MEMORY_ID ?? ''
const MAX_TOOL_USE_ITERATIONS = 5
/** imageBase64 の最大サイズ（5MB = 約 6.67MB の base64 文字列） */
const MAX_IMAGE_BASE64_LENGTH = Math.ceil(5 * 1024 * 1024 * 4 / 3)

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

    return `\n\nあなたが過去の会話から覚えていること：\n${memoryLines}`
  } catch (error) {
    console.warn('[Memory] メモリ検索エラー（スキップ）:', error)
    return ''
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

  try {
    const body = JSON.parse(event.body)
    message = body.message
    history = body.history ?? []
    systemPrompt = body.systemPrompt ?? ''
    imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : undefined

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
  const enhancedSystemPrompt = systemPrompt + memoryContext

  const messages = toConverseMessages(history, message, imageBase64)

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
      return response(200, { content })
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
