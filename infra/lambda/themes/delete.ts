import { DynamoDBClient, DeleteItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * DELETE /themes/{themeId} — テーマセッションを削除
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

  try {
    // テーマセッションと関連する MCP 接続を同時に削除
    await Promise.all([
      client.send(new DeleteItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({
          PK: `USER#${userId}`,
          SK: `THEME_SESSION#${themeId}`,
        }),
      })),
      client.send(new DeleteItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({
          PK: `USER#${userId}`,
          SK: `MCP_CONNECTION#${themeId}`,
        }),
      })),
    ])

    return response(200, { success: true })
  } catch (error) {
    console.error('テーマセッション削除エラー:', error)
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
