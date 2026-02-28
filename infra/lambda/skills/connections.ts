import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const dynamo = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME ?? 'butler-assistant'

/**
 * GET /skills/connections — 接続済みサービス一覧を取得
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  try {
    const result = await dynamo.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${userId}` },
        ':skPrefix': { S: 'SKILL_CONN#' },
      },
    }))

    const connections = (result.Items ?? []).map((item) => {
      const sk = item.SK?.S ?? ''
      const service = sk.replace('SKILL_CONN#', '')
      return {
        service,
        connectedAt: Number(item.connectedAt?.N ?? '0'),
      }
    })

    return response(200, { connections })
  } catch (error) {
    console.error('[Skills] 接続一覧取得エラー:', error)
    return response(500, { error: '接続一覧の取得に失敗しました' })
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
