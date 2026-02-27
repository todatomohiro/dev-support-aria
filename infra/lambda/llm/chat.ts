import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import {
  BedrockAgentCoreClient,
  RetrieveMemoryRecordsCommand,
} from '@aws-sdk/client-bedrock-agentcore'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const bedrock = new BedrockRuntimeClient({})
const agentCore = new BedrockAgentCoreClient({})

const MEMORY_ID = process.env.MEMORY_ID ?? ''

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
 * POST /llm/chat — Bedrock Claude でチャット応答を生成
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

  try {
    const body = JSON.parse(event.body)
    message = body.message
    history = body.history ?? []
    systemPrompt = body.systemPrompt ?? ''

    if (!message || typeof message !== 'string') {
      return response(400, { error: 'message is required' })
    }
  } catch {
    return response(400, { error: 'Invalid JSON' })
  }

  // メモリ検索（失敗してもチャットは続行）
  const memoryContext = await retrieveMemories(userId, message)
  const enhancedSystemPrompt = systemPrompt + memoryContext

  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ]

  try {
    const result = await bedrock.send(new InvokeModelCommand({
      modelId: 'jp.anthropic.claude-sonnet-4-6',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1024,
        temperature: 0.7,
        system: enhancedSystemPrompt,
        messages,
      }),
    }))

    const responseBody = JSON.parse(new TextDecoder().decode(result.body))
    const content = responseBody.content[0].text

    return response(200, { content })
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
