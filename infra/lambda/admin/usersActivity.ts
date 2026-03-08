import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { requireAdmin, isErrorResponse, response } from './middleware'

const dynamo = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * GET /admin/users/{userId}/activity — ユーザーアクティビティログ取得
 *
 * クエリパラメータ:
 *   days: 取得日数（デフォルト30、最大90）
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const auth = await requireAdmin(event)
  if (isErrorResponse(auth)) return auth

  const targetUserId = event.pathParameters?.userId
  if (!targetUserId) {
    return response(400, { error: 'userId is required' })
  }

  const days = Math.min(parseInt(event.queryStringParameters?.days ?? '30', 10) || 30, 90)

  try {
    // 指定日数分の日付範囲を計算
    const now = new Date()
    const startDate = new Date(now)
    startDate.setDate(startDate.getDate() - days)
    const startSK = `ACTIVITY#${startDate.toISOString().slice(0, 10)}`
    const endSK = `ACTIVITY#${now.toISOString().slice(0, 10)}~` // ~ は ASCII で Z より後

    const result = await dynamo.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${targetUserId}` },
        ':start': { S: startSK },
        ':end': { S: endSK },
      },
    }))

    const activities = (result.Items ?? []).map((item) => {
      const record = unmarshall(item)
      return {
        date: (record.SK as string).replace('ACTIVITY#', ''),
        activeMinutes: record.activeMinutes ? Array.from(record.activeMinutes as Set<string>).sort() : [],
      }
    })

    return response(200, { activities, days })
  } catch (error) {
    console.error('アクティビティ取得エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}
