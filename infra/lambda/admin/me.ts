import { DynamoDBClient, BatchGetItemCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { response } from './middleware'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * GET /admin/me — 自分のロールとプランを返却（ロールチェックなし）
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  try {
    const result = await client.send(new BatchGetItemCommand({
      RequestItems: {
        [TABLE_NAME]: {
          Keys: [
            { PK: { S: `USER#${userId}` }, SK: { S: 'ROLE' } },
            { PK: { S: `USER#${userId}` }, SK: { S: 'PLAN' } },
          ],
        },
      },
    }))

    const items = result.Responses?.[TABLE_NAME] ?? []
    let role = 'user'
    let plan = 'free'
    for (const item of items) {
      const parsed = unmarshall(item)
      if (parsed.SK === 'ROLE') role = parsed.role ?? 'user'
      if (parsed.SK === 'PLAN') plan = parsed.plan ?? 'free'
    }

    return response(200, { userId, role, plan })
  } catch (error) {
    console.error('ロール/プラン取得エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}
