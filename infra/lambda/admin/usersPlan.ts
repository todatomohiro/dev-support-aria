/**
 * PUT /admin/users/{userId}/plan — プラン変更（管理者のみ）
 * Body: { plan: 'free' | 'paid' }
 */
import { DynamoDBClient, PutItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { requireAdmin, isErrorResponse, response } from './middleware'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const auth = await requireAdmin(event)
  if (isErrorResponse(auth)) return auth

  const targetUserId = event.pathParameters?.userId
  if (!targetUserId) {
    return response(400, { error: 'userId is required' })
  }

  try {
    const body = JSON.parse(event.body ?? '{}')
    const { plan } = body

    if (plan !== 'free' && plan !== 'paid') {
      return response(400, { error: 'plan must be "free" or "paid"' })
    }

    const now = new Date().toISOString()

    if (plan === 'free') {
      // 無料プランに戻す場合は PLAN レコードを削除（デフォルト = free）
      await client.send(new DeleteItemCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: { S: `USER#${targetUserId}` },
          SK: { S: 'PLAN' },
        },
      }))
    } else {
      // 有料プランを付与
      await client.send(new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall({
          PK: `USER#${targetUserId}`,
          SK: 'PLAN',
          plan: 'paid',
          updatedAt: now,
          updatedBy: auth.userId,
        }),
      }))
    }

    return response(200, { userId: targetUserId, plan })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    console.error('プラン更新エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}
