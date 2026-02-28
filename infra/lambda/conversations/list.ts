import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * GET /groups — グループ一覧を取得（更新順、新しい順）
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  try {
    const result = await client.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${userId}` },
        ':prefix': { S: 'CONV_UPDATED#' },
      },
      ScanIndexForward: false, // 新しい順
    }))

    const conversations = (result.Items ?? []).map((item) => {
      const record = unmarshall(item)
      return {
        groupId: record.conversationId,
        groupName: record.groupName ?? '',
        lastMessage: record.lastMessage ?? null,
        updatedAt: record.updatedAt,
      }
    })

    return response(200, { conversations })
  } catch (error) {
    console.error('会話一覧取得エラー:', error)
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
