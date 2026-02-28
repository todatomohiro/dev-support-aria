import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * DELETE /friends/{friendUserId} — フレンド解除（双方向フレンドレコードのみ削除）
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  const friendUserId = event.pathParameters?.friendUserId
  if (!friendUserId) {
    return response(400, { error: 'friendUserId is required' })
  }

  try {
    // フレンドレコードの存在を確認
    const friendRecord = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ PK: `USER#${userId}`, SK: `FRIEND#${friendUserId}` }),
    }))

    if (!friendRecord.Item) {
      return response(404, { error: 'フレンドが見つかりません' })
    }

    // 双方向フレンドレコードをトランザクションで削除
    await client.send(new TransactWriteItemsCommand({
      TransactItems: [
        // 自分側フレンドレコード
        {
          Delete: {
            TableName: TABLE_NAME,
            Key: marshall({ PK: `USER#${userId}`, SK: `FRIEND#${friendUserId}` }),
          },
        },
        // 相手側フレンドレコード
        {
          Delete: {
            TableName: TABLE_NAME,
            Key: marshall({ PK: `USER#${friendUserId}`, SK: `FRIEND#${userId}` }),
          },
        },
      ],
    }))

    return response(200, { success: true })
  } catch (error) {
    console.error('フレンド解除エラー:', error)
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
