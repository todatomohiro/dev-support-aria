import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import * as crypto from 'crypto'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * POST /groups — グループを作成
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  if (!event.body) {
    return response(400, { error: 'Request body is required' })
  }

  try {
    const { groupName } = JSON.parse(event.body)

    if (!groupName || typeof groupName !== 'string') {
      return response(400, { error: 'groupName is required' })
    }

    const groupId = crypto.randomUUID()
    const now = Date.now()
    const paddedNow = String(now).padStart(15, '0')

    // CONV# META を作成
    await client.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        PK: `CONV#${groupId}`,
        SK: 'META',
        groupName,
        participants: [userId],
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
      }),
    }))

    // 自分の CONV_MEMBER# を作成
    await client.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        PK: `USER#${userId}`,
        SK: `CONV_MEMBER#${groupId}`,
        conversationId: groupId,
        groupName,
        updatedAt: now,
        GSI2PK: `USER#${userId}`,
        GSI2SK: `CONV_UPDATED#${paddedNow}`,
      }),
    }))

    return response(200, { groupId, groupName })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    console.error('グループ作成エラー:', error)
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
