import { DynamoDBClient, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import * as crypto from 'crypto'
import { listMCPTools } from './mcpClient'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/** ユーザーあたりの最大接続数 */
const MAX_CONNECTIONS_PER_USER = 3

/**
 * POST /mcp/connect — MCPサーバーに接続しテーマを作成
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
    const { serverUrl, ttlMinutes, metadata } = JSON.parse(event.body)

    // バリデーション
    if (!serverUrl || typeof serverUrl !== 'string' || !serverUrl.startsWith('https://')) {
      return response(400, { error: 'serverUrl must start with "https://"' })
    }

    if (!ttlMinutes || typeof ttlMinutes !== 'number' || ttlMinutes < 1 || ttlMinutes > 1440) {
      return response(400, { error: 'ttlMinutes must be between 1 and 1440' })
    }

    // アクティブ接続数チェック
    const existingConnections = await client.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${userId}` },
        ':prefix': { S: 'MCP_CONNECTION#' },
      },
    }))

    const now = new Date()
    const activeConnections = (existingConnections.Items ?? [])
      .map((item) => unmarshall(item))
      .filter((record) => record.expiresAt > now.toISOString())

    if (activeConnections.length >= MAX_CONNECTIONS_PER_USER) {
      return response(409, { error: `Maximum ${MAX_CONNECTIONS_PER_USER} active connections allowed` })
    }

    // MCPサーバーからツール一覧を取得
    const tools = await listMCPTools(serverUrl)

    // テーマを作成
    const themeId = crypto.randomUUID()
    const nowIso = now.toISOString()
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString()
    const ttlExpiry = Math.floor(new Date(expiresAt).getTime() / 1000)
    const themeName = `MCP: ${tools.length}個のツール`

    await client.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        PK: `USER#${userId}`,
        SK: `THEME_SESSION#${themeId}`,
        themeId,
        themeName,
        createdAt: nowIso,
        updatedAt: nowIso,
      }),
    }))

    // MCP接続レコードを保存
    await client.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        PK: `USER#${userId}`,
        SK: `MCP_CONNECTION#${themeId}`,
        serverUrl,
        transport: 'streamable-http',
        themeId,
        toolDefinitions: JSON.stringify(tools),
        ...(metadata ? { metadata: JSON.stringify(metadata) } : {}),
        connectedAt: nowIso,
        expiresAt,
        ttlExpiry,
      }),
    }))

    return response(200, {
      themeId,
      themeName,
      tools: tools.map((t) => ({ name: t.name, description: t.description })),
      expiresAt,
    })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    console.error('MCP接続エラー:', error)
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
