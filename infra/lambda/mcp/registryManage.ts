import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { isValidRegistryCode } from './registryResolve'

const client = new DynamoDBClient({})
const REGISTRY_TABLE_NAME = process.env.REGISTRY_TABLE_NAME!

/** コード自動生成のリトライ上限 */
const MAX_CODE_GENERATION_RETRIES = 3

/**
 * ランダムな 3文字の小文字アルファベットを生成
 */
function randomSegment(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz'
  let segment = ''
  for (let i = 0; i < 3; i++) {
    segment += chars[Math.floor(Math.random() * chars.length)]
  }
  return segment
}

/**
 * xxx-xxx-xxx 形式のランダムコードを生成
 */
function generateCode(): string {
  return `${randomSegment()}-${randomSegment()}-${randomSegment()}`
}

/**
 * POST /mcp/registry — レジストリ登録
 */
async function handleCreate(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body!)
  const { serverUrl, transport, displayName, description, defaultTtlMinutes, config, script, code: requestedCode, expiresAt } = body

  if (!serverUrl || typeof serverUrl !== 'string') {
    return response(400, { error: 'serverUrl is required' })
  }
  if (!displayName || typeof displayName !== 'string') {
    return response(400, { error: 'displayName is required' })
  }

  const userId = event.requestContext.authorizer?.claims?.sub
  const now = new Date().toISOString()

  // コード決定: 指定があればバリデーション、なければ自動生成
  let code: string
  if (requestedCode) {
    if (!isValidRegistryCode(requestedCode)) {
      return response(400, { error: 'code must match xxx-xxx-xxx format (lowercase a-z only)' })
    }
    code = requestedCode
  } else {
    code = generateCode()
  }

  // collision チェック付き書き込み（最大3回リトライ）
  let retries = requestedCode ? 1 : MAX_CODE_GENERATION_RETRIES
  while (retries > 0) {
    try {
      const item: Record<string, unknown> = {
        code,
        serverUrl,
        transport: transport ?? 'streamable-http',
        displayName,
        defaultTtlMinutes: defaultTtlMinutes ?? 30,
        active: true,
        createdAt: now,
        updatedAt: now,
      }
      if (description) item.description = description
      if (config) item.config = typeof config === 'string' ? config : JSON.stringify(config)
      if (script) item.script = script
      if (userId) item.createdBy = userId
      if (expiresAt) {
        item.expiresAt = expiresAt
        item.ttlExpiry = Math.floor(new Date(expiresAt).getTime() / 1000)
      }

      await client.send(new PutItemCommand({
        TableName: REGISTRY_TABLE_NAME,
        Item: marshall(item),
        ConditionExpression: 'attribute_not_exists(code)',
      }))

      return response(201, { code, ...item })
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
        if (requestedCode) {
          return response(409, { error: 'This code is already registered' })
        }
        retries--
        code = generateCode()
        continue
      }
      throw err
    }
  }

  return response(500, { error: 'Failed to generate unique code' })
}

/**
 * GET /mcp/registry?code=xxx — レジストリ取得
 */
async function handleGet(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const code = event.queryStringParameters?.code
  if (!code || !isValidRegistryCode(code)) {
    return response(400, { error: 'Valid code parameter is required (xxx-xxx-xxx format)' })
  }

  const result = await client.send(new GetItemCommand({
    TableName: REGISTRY_TABLE_NAME,
    Key: { code: { S: code } },
  }))

  if (!result.Item) {
    return response(404, { error: 'Registry entry not found' })
  }

  return response(200, unmarshall(result.Item))
}

/**
 * PATCH /mcp/registry — レジストリ更新
 */
async function handleUpdate(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body!)
  const { code, ...updates } = body

  if (!code || !isValidRegistryCode(code)) {
    return response(400, { error: 'Valid code is required (xxx-xxx-xxx format)' })
  }

  // 更新可能フィールド
  const allowedFields = ['serverUrl', 'transport', 'displayName', 'description', 'defaultTtlMinutes', 'config', 'script', 'active', 'expiresAt']
  const updateExpressions: string[] = ['#updatedAt = :updatedAt']
  const expressionNames: Record<string, string> = { '#updatedAt': 'updatedAt' }
  const expressionValues: Record<string, unknown> = { ':updatedAt': new Date().toISOString() }

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      const placeholder = `:${field}`
      const nameKey = `#${field}`
      updateExpressions.push(`${nameKey} = ${placeholder}`)
      expressionNames[nameKey] = field
      expressionValues[placeholder] = field === 'config' && typeof updates[field] !== 'string'
        ? JSON.stringify(updates[field])
        : updates[field]
    }
  }

  // expiresAt が更新された場合は ttlExpiry も更新
  if (updates.expiresAt) {
    updateExpressions.push('#ttlExpiry = :ttlExpiry')
    expressionNames['#ttlExpiry'] = 'ttlExpiry'
    expressionValues[':ttlExpiry'] = Math.floor(new Date(updates.expiresAt).getTime() / 1000)
  }

  const result = await client.send(new UpdateItemCommand({
    TableName: REGISTRY_TABLE_NAME,
    Key: { code: { S: code } },
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionNames,
    ExpressionAttributeValues: marshall(expressionValues),
    ConditionExpression: 'attribute_exists(code)',
    ReturnValues: 'ALL_NEW',
  }))

  if (!result.Attributes) {
    return response(404, { error: 'Registry entry not found' })
  }

  return response(200, unmarshall(result.Attributes))
}

/**
 * DELETE /mcp/registry?code=xxx — レジストリ削除
 */
async function handleDelete(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const code = event.queryStringParameters?.code
  if (!code || !isValidRegistryCode(code)) {
    return response(400, { error: 'Valid code parameter is required (xxx-xxx-xxx format)' })
  }

  await client.send(new DeleteItemCommand({
    TableName: REGISTRY_TABLE_NAME,
    Key: { code: { S: code } },
    ConditionExpression: 'attribute_exists(code)',
  }))

  return response(200, { deleted: true })
}

/**
 * レジストリ管理 Lambda ハンドラー
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    switch (event.httpMethod) {
      case 'POST':
        return await handleCreate(event)
      case 'GET':
        return await handleGet(event)
      case 'PATCH':
        return await handleUpdate(event)
      case 'DELETE':
        return await handleDelete(event)
      default:
        return response(405, { error: 'Method not allowed' })
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    console.error('レジストリ管理エラー:', error)
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
