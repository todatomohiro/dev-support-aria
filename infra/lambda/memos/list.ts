import { DynamoDBClient, QueryCommand, PutItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import * as crypto from 'crypto'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * GET /memos — メモ一覧を取得
 * POST /memos — メモを保存
 * DELETE /memos/{memoId} — メモを削除
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  if (event.httpMethod === 'POST') {
    return handleSave(userId, event.body)
  }
  if (event.httpMethod === 'DELETE') {
    return handleDelete(userId, event.pathParameters?.memoId)
  }
  return handleList(userId, event)
}

/** GET /memos ハンドラー */
async function handleList(userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const query = event.queryStringParameters?.query?.toLowerCase()
    const limit = Math.min(parseInt(event.queryStringParameters?.limit ?? '50', 10), 100)

    const result = await client.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${userId}` },
        ':skPrefix': { S: 'MEMO#' },
      },
      ScanIndexForward: false,
    }))

    let memos = (result.Items ?? []).map((item) => {
      const m = unmarshall(item)
      return {
        memoId: m.memoId,
        title: m.title,
        content: m.content,
        tags: m.tags ?? [],
        source: m.source ?? 'chat',
        createdAt: m.createdAt,
      }
    })

    // createdAt 降順ソート
    memos.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    // キーワードフィルタリング
    if (query) {
      memos = memos.filter((m) =>
        m.title.toLowerCase().includes(query) ||
        m.content.toLowerCase().includes(query) ||
        m.tags.some((t: string) => t.toLowerCase().includes(query))
      )
    }

    return response(200, { memos: memos.slice(0, limit), total: memos.length })
  } catch (error) {
    console.error('メモ一覧取得エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}

/** POST /memos ハンドラー */
async function handleSave(userId: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) {
    return response(400, { error: 'Request body is required' })
  }
  try {
    const { title, content, tags, source } = JSON.parse(body)

    if (!title || typeof title !== 'string') {
      return response(400, { error: 'title is required' })
    }
    if (!content || typeof content !== 'string') {
      return response(400, { error: 'content is required' })
    }
    if (content.length > 500) {
      return response(400, { error: 'content must be 500 characters or less' })
    }

    const memoId = crypto.randomUUID()
    const now = new Date().toISOString()

    const item: Record<string, unknown> = {
      PK: `USER#${userId}`,
      SK: `MEMO#${memoId}`,
      memoId,
      title: title.slice(0, 50),
      content,
      tags: Array.isArray(tags) ? tags.slice(0, 10).map((t: unknown) => String(t).slice(0, 20)) : [],
      source: source === 'chat' || source === 'quick' ? source : 'chat',
      createdAt: now,
      updatedAt: now,
    }

    await client.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall(item),
    }))

    return response(200, { memoId, title: item.title, createdAt: now })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    console.error('メモ保存エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}

/** DELETE /memos/{memoId} ハンドラー */
async function handleDelete(userId: string, memoId: string | undefined): Promise<APIGatewayProxyResult> {
  if (!memoId) {
    return response(400, { error: 'memoId is required' })
  }
  try {
    await client.send(new DeleteItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: `MEMO#${memoId}` },
      },
    }))
    return response(200, { deleted: true })
  } catch (error) {
    console.error('メモ削除エラー:', error)
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
