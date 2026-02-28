import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * GET /friends/code — 自分のフレンドコードを取得
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  try {
    const result = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ PK: `USER#${userId}`, SK: 'FRIEND_CODE' }),
    }))

    if (result.Item) {
      const record = unmarshall(result.Item)
      return response(200, { code: record.code })
    }

    return response(200, { code: null })
  } catch (error) {
    console.error('フレンドコード取得エラー:', error)
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
