import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import * as crypto from 'crypto'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * POST /themes — テーマセッションを作成
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  if (!event.body) {
    return response(400, { error: 'Request body is required' })
  }

  try {
    const { themeName, modelKey } = JSON.parse(event.body)

    if (!themeName || typeof themeName !== 'string') {
      return response(400, { error: 'themeName is required' })
    }

    // modelKey のバリデーション（デフォルト haiku）
    const validModelKeys = ['haiku', 'sonnet', 'opus']
    const resolvedModelKey = typeof modelKey === 'string' && validModelKeys.includes(modelKey) ? modelKey : 'haiku'

    const themeId = crypto.randomUUID()
    const now = new Date().toISOString()

    await client.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        PK: `USER#${userId}`,
        SK: `THEME_SESSION#${themeId}`,
        themeId,
        themeName,
        modelKey: resolvedModelKey,
        createdAt: now,
        updatedAt: now,
      }),
    }))

    return response(200, { themeId, themeName, modelKey: resolvedModelKey })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    console.error('テーマセッション作成エラー:', error)
    return response(500, { error: 'Internal server error' })
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
