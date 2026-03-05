import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { response } from './middleware'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * GET /admin/me — 自分のロールを返却（ロールチェックなし）
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  try {
    const result = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: 'ROLE' },
      },
    }))

    const role = result.Item ? unmarshall(result.Item).role : 'user'

    return response(200, { userId, role })
  } catch (error) {
    console.error('ロール取得エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}
