import { DynamoDBClient, PutItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { requireAdmin, isErrorResponse, response } from './middleware'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * PUT /admin/users/{userId}/role — ロール付与/剥奪
 * PUT /admin/users/{userId}/plan — プラン変更
 *
 * resource パスで分岐。
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const auth = await requireAdmin(event)
  if (isErrorResponse(auth)) return auth

  const targetUserId = event.pathParameters?.userId
  if (!targetUserId) {
    return response(400, { error: 'userId is required' })
  }

  // パスで分岐
  const resource = event.resource ?? ''
  if (resource.endsWith('/plan')) {
    return handlePlan(auth.userId, targetUserId, event.body)
  }
  return handleRole(auth.userId, targetUserId, event.body)
}

/** ロール変更 */
async function handleRole(adminUserId: string, targetUserId: string, body: string | null): Promise<APIGatewayProxyResult> {
  try {
    const parsed = JSON.parse(body ?? '{}')
    const { role } = parsed

    if (role !== 'admin' && role !== 'user') {
      return response(400, { error: 'role must be "admin" or "user"' })
    }

    // 自己降格防止
    if (targetUserId === adminUserId && role !== 'admin') {
      return response(400, { error: 'Cannot remove your own admin role' })
    }

    const now = new Date().toISOString()

    if (role === 'user') {
      await client.send(new DeleteItemCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: { S: `USER#${targetUserId}` },
          SK: { S: 'ROLE' },
        },
      }))
    } else {
      await client.send(new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall({
          PK: `USER#${targetUserId}`,
          SK: 'ROLE',
          role: 'admin',
          updatedAt: now,
          updatedBy: adminUserId,
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

/** プラン変更 */
async function handlePlan(adminUserId: string, targetUserId: string, body: string | null): Promise<APIGatewayProxyResult> {
  try {
    const parsed = JSON.parse(body ?? '{}')
    const { plan } = parsed

    if (plan !== 'free' && plan !== 'paid') {
      return response(400, { error: 'plan must be "free" or "paid"' })
    }

    const now = new Date().toISOString()

    if (plan === 'free') {
      await client.send(new DeleteItemCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: { S: `USER#${targetUserId}` },
          SK: { S: 'PLAN' },
        },
      }))
    } else {
      await client.send(new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall({
          PK: `USER#${targetUserId}`,
          SK: 'PLAN',
          plan: 'paid',
          updatedAt: now,
          updatedBy: adminUserId,
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
