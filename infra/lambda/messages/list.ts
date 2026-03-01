import { DynamoDBClient, QueryCommand, type QueryCommandInput } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * GET /messages?limit=100&before={sk} — メッセージ一覧を取得（新しい順、カーソルページネーション対応）
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  const limit = Math.min(
    parseInt(event.queryStringParameters?.limit ?? '100', 10) || 100,
    500
  )
  const before = event.queryStringParameters?.before

  try {
    const queryInput: QueryCommandInput = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${userId}` },
        ':prefix': { S: 'MSG#' },
      },
      ScanIndexForward: false, // 新しい順
      Limit: limit,
    }

    // カーソルページネーション
    if (before) {
      queryInput.ExclusiveStartKey = marshall({
        PK: `USER#${userId}`,
        SK: before,
      })
    }

    const result = await client.send(new QueryCommand(queryInput))

    const messages = (result.Items ?? []).map((item) => {
      const record = unmarshall(item)
      return record.data
    })

    const responseBody: Record<string, unknown> = { messages }
    if (result.LastEvaluatedKey) {
      const lastKey = unmarshall(result.LastEvaluatedKey)
      responseBody.nextCursor = lastKey.SK
    }

    return response(200, responseBody)
  } catch (error) {
    console.error('メッセージ取得エラー:', error)
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
