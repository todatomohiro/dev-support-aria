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

  let themeName: string
  try {
    const body = JSON.parse(event.body)
    themeName = body.themeName
    if (!themeName || typeof themeName !== 'string' || !themeName.trim()) {
      return response(400, { error: 'themeName is required' })
    }
    themeName = themeName.trim()
  } catch {
    return response(400, { error: 'Invalid JSON' })
  }

  try {
    await client.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: `THEME_SESSION#${themeId}` },
      },
      UpdateExpression: 'SET themeName = :name, updatedAt = :now',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeValues: {
        ':name': { S: themeName },
        ':now': { S: new Date().toISOString() },
      },
    }))

    return response(200, { themeId, themeName })
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
