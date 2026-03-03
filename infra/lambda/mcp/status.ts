import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * GET /mcp/status?themeId={themeId} — MCP接続ステータスを取得
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  const themeId = event.queryStringParameters?.themeId
  if (!themeId) {
    return response(400, { error: 'themeId is required' })
  }

  try {
    const result = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: `MCP_CONNECTION#${themeId}` },
      },
    }))

    if (!result.Item) {
      return response(200, { active: false, tools: [], expiresAt: null, serverUrl: null })
    }

    const record = unmarshall(result.Item)
    const now = new Date().toISOString()
    const isActive = record.expiresAt > now

    if (!isActive) {
      return response(200, { active: false, tools: [], expiresAt: null, serverUrl: null })
    }

    const tools = JSON.parse(record.toolDefinitions || '[]') as Array<{ name: string; description?: string }>

    return response(200, {
      active: true,
      tools: tools.map((t) => ({ name: t.name, description: t.description })),
      expiresAt: record.expiresAt,
      serverUrl: record.serverUrl,
    })
  } catch (error) {
    console.error('MCP接続ステータス取得エラー:', error)
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
