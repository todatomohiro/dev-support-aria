import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { requireAdmin, isErrorResponse, response } from './middleware'

const dynamo = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * GET /admin/users/{userId}/memory — 永久記憶（PERMANENT_FACTS）を取得
 * DELETE /admin/users/{userId}/memory — 個別項目を削除
 *   body: { category: 'facts' | 'preferences', index: number }
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const auth = await requireAdmin(event)
  if (isErrorResponse(auth)) return auth

  const targetUserId = event.pathParameters?.userId
  if (!targetUserId) {
    return response(400, { error: 'userId is required' })
  }

  const method = event.httpMethod

  if (method === 'GET') {
    return handleGet(targetUserId)
  }

  if (method === 'DELETE') {
    return handleDelete(targetUserId, event.body)
  }

  return response(405, { error: 'Method not allowed' })
}

/** 永久記憶の取得 */
async function handleGet(userId: string): Promise<APIGatewayProxyResult> {
  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: 'PERMANENT_FACTS' },
      },
    }))

    if (!result.Item) {
      return response(200, { facts: [], preferences: [], lastUpdatedAt: null })
    }

    const item = unmarshall(result.Item)
    return response(200, {
      facts: (item.facts ?? []) as string[],
      preferences: (item.preferences ?? []) as string[],
      lastUpdatedAt: item.lastUpdatedAt ?? null,
    })
  } catch (error) {
    console.error('永久記憶取得エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}

/** 個別項目の削除 */
async function handleDelete(userId: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) {
    return response(400, { error: 'Request body is required' })
  }

  try {
    const { category, index } = JSON.parse(body) as { category?: string; index?: number }

    if (category !== 'facts' && category !== 'preferences') {
      return response(400, { error: 'category must be "facts" or "preferences"' })
    }
    if (typeof index !== 'number' || index < 0) {
      return response(400, { error: 'index must be a non-negative number' })
    }

    // 現在のデータを取得
    const result = await dynamo.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: 'PERMANENT_FACTS' },
      },
    }))

    if (!result.Item) {
      return response(404, { error: 'No permanent memory found' })
    }

    const item = unmarshall(result.Item)
    const items = (item[category] ?? []) as string[]

    if (index >= items.length) {
      return response(400, { error: `index ${index} out of range (length: ${items.length})` })
    }

    // 項目を削除
    const updated = [...items.slice(0, index), ...items.slice(index + 1)]

    await dynamo.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: 'PERMANENT_FACTS' },
      },
      UpdateExpression: 'SET #cat = :items, lastUpdatedAt = :now',
      ExpressionAttributeNames: {
        '#cat': category,
      },
      ExpressionAttributeValues: {
        ':items': { L: updated.map((s) => ({ S: s })) },
        ':now': { S: new Date().toISOString() },
      },
    }))

    return response(200, {
      success: true,
      deleted: items[index],
      remaining: updated.length,
    })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    console.error('永久記憶削除エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}
