import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const bedrock = new BedrockRuntimeClient({})

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
        system: systemPrompt,
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
