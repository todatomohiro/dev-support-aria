import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * GET /themes — テーマセッション一覧を取得
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  try {
    // テーマ一覧と MCP 接続を並列取得
    const [themeResult, mcpResult] = await Promise.all([
      client.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': { S: `USER#${userId}` },
          ':prefix': { S: 'THEME_SESSION#' },
        },
      })),
      client.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': { S: `USER#${userId}` },
          ':prefix': { S: 'MCP_CONNECTION#' },
        },
      })),
    ])

    // アクティブな MCP 接続を themeId でマッピング
    const now = new Date().toISOString()
    const activeMcpByTheme = new Map(
      (mcpResult.Items ?? [])
        .map((item) => unmarshall(item))
        .filter((record) => record.expiresAt > now)
        .map((record) => [record.themeId as string, record.expiresAt as string] as const)
    )

    const themes = (themeResult.Items ?? [])
      .map((item) => {
        const record = unmarshall(item)
        const workExpiresAt = activeMcpByTheme.get(record.themeId as string)
        return {
          themeId: record.themeId,
          themeName: record.themeName,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          modelKey: record.modelKey ?? 'haiku',
          ...(record.category ? { category: record.category } : {}),
          ...(record.subcategory ? { subcategory: record.subcategory } : {}),
          ...(workExpiresAt ? { workActive: true, workExpiresAt } : {}),
        }
      })
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))

    return response(200, { themes })
  } catch (error) {
    console.error('テーマセッション一覧取得エラー:', error)
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
