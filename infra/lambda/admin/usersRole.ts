import { DynamoDBClient, PutItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { requireAdmin, isErrorResponse, response } from './middleware'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * PUT /admin/users/{userId}/role — ロール付与/剥奪
 * Body: { role: 'admin' | 'user' }
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const auth = await requireAdmin(event)
  if (isErrorResponse(auth)) return auth

  const targetUserId = event.pathParameters?.userId
  if (!targetUserId) {
    return response(400, { error: 'userId is required' })
  }

  try {
    const body = JSON.parse(event.body ?? '{}')
    const { role } = body

    if (role !== 'admin' && role !== 'user') {
      return response(400, { error: 'role must be "admin" or "user"' })
    }

    // 自己降格防止
    if (targetUserId === auth.userId && role !== 'admin') {
      return response(400, { error: 'Cannot remove your own admin role' })
    }

    const now = new Date().toISOString()

    if (role === 'user') {
      // 一般ユーザーに戻す場合は ROLE レコードを削除（デフォルト = user）
      await client.send(new DeleteItemCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: { S: `USER#${targetUserId}` },
          SK: { S: 'ROLE' },
        },
      }))
    } else {
      // admin ロールを付与
      await client.send(new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall({
          PK: `USER#${targetUserId}`,
          SK: 'ROLE',
          role: 'admin',
          updatedAt: now,
          updatedBy: auth.userId,
        }),
      }))
    }

    return response(200, { userId: targetUserId, role })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    console.error('ロール更新エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}
