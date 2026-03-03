import { DynamoDBClient, DeleteItemCommand, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import * as crypto from 'crypto'
import { listMCPTools } from './mcpClient'
import { isValidRegistryCode, resolveRegistryCode } from './registryResolve'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/** ユーザーあたりの最大接続数 */
const MAX_CONNECTIONS_PER_USER = 3

/**
 * POST /mcp/connect — MCPサーバーに接続しテーマを作成
 *
 * リクエストボディ:
 * - { code: "xxx-xxx-xxx" } — レジストリコードで接続
 * - { serverUrl: "https://...", ttlMinutes: N } — URL直接指定（後方互換）
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
    const body = JSON.parse(event.body)

    let serverUrl: string
    let ttlMinutes: number
    let themeName: string
    let registryCode: string | undefined
    let metadata: Record<string, unknown> | undefined

    if (body.code && isValidRegistryCode(body.code)) {
      // レジストリコードで接続
      const entry = await resolveRegistryCode(body.code)
      serverUrl = entry.serverUrl
      ttlMinutes = body.ttlMinutes ?? entry.defaultTtlMinutes
      registryCode = body.code

      // ツール一覧を取得してテーマ名を決定
      const tools = await listMCPTools(serverUrl)
      themeName = entry.displayName ?? `MCP: ${tools.length}個のツール`

      return await createConnectionAndTheme({
        userId, serverUrl, ttlMinutes, themeName, registryCode, metadata, tools,
        greeting: entry.greeting, description: entry.description,
      })
    } else if (body.serverUrl && typeof body.serverUrl === 'string' && body.serverUrl.startsWith('https://')) {
      // URL直接指定（後方互換）
      serverUrl = body.serverUrl
      ttlMinutes = body.ttlMinutes
      metadata = body.metadata

      if (!ttlMinutes || typeof ttlMinutes !== 'number' || ttlMinutes < 1 || ttlMinutes > 1440) {
        return response(400, { error: 'ttlMinutes must be between 1 and 1440' })
      }

      const tools = await listMCPTools(serverUrl)
      themeName = `MCP: ${tools.length}個のツール`

      return await createConnectionAndTheme({
        userId, serverUrl, ttlMinutes, themeName, metadata, tools,
      })
    } else {
      return response(400, { error: 'code (xxx-xxx-xxx format) or serverUrl (https://) is required' })
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    // レジストリ解決エラー
    if (error instanceof Error && (
      error.message.includes('レジストリコード') || error.message.includes('有効期限')
    )) {
      return response(400, { error: error.message })
    }
    console.error('MCP接続エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}

/** 接続レコードとテーマを作成する共通処理 */
async function createConnectionAndTheme(params: {
  userId: string
  serverUrl: string
  ttlMinutes: number
  themeName: string
  registryCode?: string
  metadata?: Record<string, unknown>
  tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
  greeting?: string
  description?: string
}): Promise<APIGatewayProxyResult> {
  const { userId, serverUrl, ttlMinutes, themeName, registryCode, metadata, tools, greeting, description } = params

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
  const nowIsoForFilter = now.toISOString()
  const allConnections = (existingConnections.Items ?? []).map((item) => unmarshall(item))
  const activeConnections = allConnections.filter((record) => record.expiresAt > nowIsoForFilter)
  const expiredConnections = allConnections.filter((record) => record.expiresAt <= nowIsoForFilter)

  // 期限切れレコードをバックグラウンドで削除（TTL 削除は最大48時間遅延するため）
  if (expiredConnections.length > 0) {
    const deletePromises = expiredConnections.map((record) =>
      client.send(new DeleteItemCommand({
        TableName: TABLE_NAME,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: `MCP_CONNECTION#${record.themeId}` } },
      })).catch(() => { /* 削除失敗は無視 */ })
    )
    Promise.all(deletePromises).catch(() => {})
  }

  if (activeConnections.length >= MAX_CONNECTIONS_PER_USER) {
    return response(409, { error: `Maximum ${MAX_CONNECTIONS_PER_USER} active connections allowed` })
  }

  // テーマを作成
  const themeId = crypto.randomUUID()
  const nowIso = now.toISOString()
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString()
  const ttlExpiry = Math.floor(new Date(expiresAt).getTime() / 1000)

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
      ...(registryCode ? { registryCode } : {}),
      ...(metadata ? { metadata: JSON.stringify(metadata) } : {}),
      ...(greeting ? { greeting } : {}),
      ...(description ? { description } : {}),
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
    ...(greeting ? { greeting } : {}),
    ...(description ? { description } : {}),
  })
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
