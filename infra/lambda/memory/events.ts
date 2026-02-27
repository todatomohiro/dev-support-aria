import {
  BedrockAgentCoreClient,
  CreateEventCommand,
} from '@aws-sdk/client-bedrock-agentcore'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const agentCore = new BedrockAgentCoreClient({})

const MEMORY_ID = process.env.MEMORY_ID ?? ''

/**
 * POST /memory/events — 会話ターンを AgentCore Memory に記録
 *
 * fire-and-forget で呼び出されるため、フロントエンドはレスポンスを待たない。
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  if (!MEMORY_ID) {
    console.warn('[Memory] MEMORY_ID が未設定です')
    return response(500, { error: 'Memory not configured' })
  }

  if (!event.body) {
    return response(400, { error: 'Request body is required' })
  }

  let messages: Array<{ role: string; content: string }>

  try {
    const body = JSON.parse(event.body)
    messages = body.messages

    if (!Array.isArray(messages) || messages.length === 0) {
      return response(400, { error: 'messages array is required' })
    }
  } catch {
    return response(400, { error: 'Invalid JSON' })
  }

  try {
    const roleMap: Record<string, string> = {
      user: 'USER',
      assistant: 'ASSISTANT',
    }

    await agentCore.send(new CreateEventCommand({
      memoryId: MEMORY_ID,
      actorId: userId,
      eventTimestamp: new Date(),
      payload: messages.map((m) => ({
        conversational: {
          role: roleMap[m.role] ?? 'OTHER',
          content: { text: m.content },
        },
      })),
    }))

    return response(200, { success: true })
  } catch (error) {
    console.error('[Memory] CreateEvent エラー:', error)
    return response(500, { error: 'Failed to create memory event' })
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
