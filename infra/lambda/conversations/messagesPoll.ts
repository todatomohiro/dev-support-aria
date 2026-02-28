import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * GET /conversations/{id}/messages/new?after={ts} — 新着メッセージをポーリング
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  const conversationId = event.pathParameters?.id
  if (!conversationId) {
    return response(400, { error: 'conversationId is required' })
  }

  const after = event.queryStringParameters?.after
  if (!after) {
    return response(400, { error: 'after parameter is required' })
  }

  try {
    // 参加者であることを確認
    const membership = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ PK: `USER#${userId}`, SK: `CONV_MEMBER#${conversationId}` }),
    }))

    if (!membership.Item) {
      return response(403, { error: 'この会話へのアクセス権がありません' })
    }

    const paddedAfter = String(after).padStart(15, '0')

    const result = await client.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK > :after',
      ExpressionAttributeValues: {
        ':pk': { S: `CONV#${conversationId}` },
        ':after': { S: `CMSG#${paddedAfter}` },
      },
      ScanIndexForward: true, // 古い順
    }))

    const messages = (result.Items ?? [])
      .filter((item) => {
        const sk = item.SK?.S ?? ''
        return sk.startsWith('CMSG#')
      })
      .map((item) => {
        const record = unmarshall(item)
        return {
          id: record.id,
          senderId: record.senderId,
          senderName: record.senderName,
          content: record.content,
          timestamp: record.timestamp,
          type: record.type,
        }
      })

    return response(200, { messages })
  } catch (error) {
    console.error('メッセージポーリングエラー:', error)
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
