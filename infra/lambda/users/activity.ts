import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/** 30日（秒） */
const TTL_DAYS = 30

/** 分単位タイムスタンプの正規表現（YYYY-MM-DDTHH:mm） */
const MINUTE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

/**
 * POST /users/activity — アクティビティログをバッチ保存
 *
 * リクエストボディ: { activeMinutes: string[] }
 * 各要素は "YYYY-MM-DDTHH:mm" 形式。日付ごとに分割し、DynamoDB String Set で重複排除保存する。
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
    const { activeMinutes } = JSON.parse(event.body) as { activeMinutes?: string[] }

    if (!Array.isArray(activeMinutes) || activeMinutes.length === 0) {
      return response(400, { error: 'activeMinutes must be a non-empty array' })
    }

    // バリデーション + 日付ごとにグループ化
    const byDate = new Map<string, string[]>()
    for (const minute of activeMinutes) {
      if (typeof minute !== 'string' || !MINUTE_REGEX.test(minute)) continue
      const date = minute.slice(0, 10) // "YYYY-MM-DD"
      const existing = byDate.get(date)
      if (existing) {
        existing.push(minute)
      } else {
        byDate.set(date, [minute])
      }
    }

    if (byDate.size === 0) {
      return response(400, { error: 'No valid activeMinutes provided' })
    }

    // 日付ごとに DynamoDB へ書き込み（最善努力）
    const ttlEpoch = Math.floor(Date.now() / 1000) + TTL_DAYS * 24 * 60 * 60
    const errors: string[] = []

    await Promise.all(
      Array.from(byDate.entries()).map(async ([date, minutes]) => {
        try {
          await client.send(new UpdateItemCommand({
            TableName: TABLE_NAME,
            Key: {
              PK: { S: `USER#${userId}` },
              SK: { S: `ACTIVITY#${date}` },
            },
            UpdateExpression: 'ADD activeMinutes :newMinutes SET #ttl = :ttl',
            ExpressionAttributeNames: {
              '#ttl': 'ttlExpiry',
            },
            ExpressionAttributeValues: {
              ':newMinutes': { SS: minutes },
              ':ttl': { N: String(ttlEpoch) },
            },
          }))
        } catch (err) {
          console.error(`アクティビティ保存エラー (${date}):`, err)
          errors.push(date)
        }
      })
    )

    if (errors.length > 0) {
      return response(207, { success: true, partialErrors: errors })
    }

    return response(200, { success: true })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    console.error('アクティビティ保存エラー:', error)
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
