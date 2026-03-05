import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import * as crypto from 'crypto'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * POST /memos — メモを保存
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
    const { title, content, tags, source } = JSON.parse(event.body)

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
