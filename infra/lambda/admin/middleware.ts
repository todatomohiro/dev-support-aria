import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * 管理者権限チェックミドルウェア
 * Cognito sub → DynamoDB ROLE GetItem → admin 以外は 403
 */
export async function requireAdmin(event: APIGatewayProxyEvent): Promise<{ userId: string } | APIGatewayProxyResult> {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  const result = await client.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: { S: `USER#${userId}` },
      SK: { S: 'ROLE' },
    },
  }))

  if (!result.Item) {
    return response(403, { error: 'Forbidden' })
  }

  const item = unmarshall(result.Item)
  if (item.role !== 'admin') {
    return response(403, { error: 'Forbidden' })
  }

  return { userId }
}

/** レスポンスが APIGatewayProxyResult かどうかの型ガード */
export function isErrorResponse(result: { userId: string } | APIGatewayProxyResult): result is APIGatewayProxyResult {
  return 'statusCode' in result
}

/** 共通レスポンスヘルパー */
export function response(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  }
}
