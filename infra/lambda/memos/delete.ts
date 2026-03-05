import { DynamoDBClient, DeleteItemCommand } from '@aws-sdk/client-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * DELETE /memos/{memoId} — メモを削除
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  const memoId = event.pathParameters?.memoId
  if (!memoId) {
    return response(400, { error: 'memoId is required' })
  }

  try {
    await client.send(new DeleteItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: `MEMO#${memoId}` },
      },
    }))

    return response(200, { deleted: true })
  } catch (error) {
    console.error('メモ削除エラー:', error)
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
