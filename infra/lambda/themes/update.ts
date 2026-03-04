import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * PATCH /themes/{themeId} — テーマ名を更新
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  const themeId = event.pathParameters?.themeId
  if (!themeId) {
    return response(400, { error: 'themeId is required' })
  }

  if (!event.body) {
    return response(400, { error: 'Request body is required' })
  }

  let themeName: string | undefined
  let modelKey: string | undefined
  try {
    const body = JSON.parse(event.body)

    // themeName のバリデーション（オプション）
    if (body.themeName !== undefined) {
      if (typeof body.themeName !== 'string' || !body.themeName.trim()) {
        return response(400, { error: 'themeName must be a non-empty string' })
      }
      themeName = body.themeName.trim()
    }

    // modelKey のバリデーション（オプション）
    const validModelKeys = ['haiku', 'sonnet', 'opus']
    if (body.modelKey !== undefined) {
      if (typeof body.modelKey !== 'string' || !validModelKeys.includes(body.modelKey)) {
        return response(400, { error: 'modelKey must be one of: haiku, sonnet, opus' })
      }
      modelKey = body.modelKey
    }

    // 少なくとも一方が必要
    if (!themeName && !modelKey) {
      return response(400, { error: 'themeName or modelKey is required' })
    }
  } catch {
    return response(400, { error: 'Invalid JSON' })
  }

  try {
    // 動的に UpdateExpression を構築
    const updateParts: string[] = ['updatedAt = :now']
    const expressionValues: Record<string, { S: string }> = {
      ':now': { S: new Date().toISOString() },
    }

    if (themeName) {
      updateParts.push('themeName = :name')
      expressionValues[':name'] = { S: themeName }
    }
    if (modelKey) {
      updateParts.push('modelKey = :mk')
      expressionValues[':mk'] = { S: modelKey }
    }

    await client.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: `THEME_SESSION#${themeId}` },
      },
      UpdateExpression: `SET ${updateParts.join(', ')}`,
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeValues: expressionValues,
    }))

    return response(200, { themeId, ...(themeName ? { themeName } : {}), ...(modelKey ? { modelKey } : {}) })
  } catch (error) {
    const err = error as { name?: string }
    if (err.name === 'ConditionalCheckFailedException') {
      return response(404, { error: 'Theme not found' })
    }
    console.error('テーマ更新エラー:', error)
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
