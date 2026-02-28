import { DynamoDBClient, GetItemCommand, QueryCommand, type QueryCommandInput } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * GET /conversations/{id}/messages?limit=50&before={sk} — 会話メッセージ一覧を取得
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

  try {
    // 参加者であることを確認し、相手の userId を取得
    const membership = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ PK: `USER#${userId}`, SK: `CONV_MEMBER#${conversationId}` }),
    }))

    if (!membership.Item) {
      return response(403, { error: 'この会話へのアクセス権がありません' })
    }

    const memberRecord = unmarshall(membership.Item)
    const otherUserId = memberRecord.otherUserId as string | undefined

    const limit = Math.min(
      parseInt(event.queryStringParameters?.limit ?? '50', 10) || 50,
      200
    )
    const before = event.queryStringParameters?.before

    const queryInput: QueryCommandInput = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `CONV#${conversationId}` },
        ':prefix': { S: 'CMSG#' },
      },
      ScanIndexForward: false, // 新しい順
      Limit: limit,
    }

    // カーソルページネーション
    if (before) {
      queryInput.ExclusiveStartKey = marshall({
        PK: `CONV#${conversationId}`,
        SK: before,
      })
    }

    const result = await client.send(new QueryCommand(queryInput))

    const messages = (result.Items ?? []).map((item) => {
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

    const responseBody: Record<string, unknown> = { messages }
    if (result.LastEvaluatedKey) {
      const lastKey = unmarshall(result.LastEvaluatedKey)
      responseBody.nextCursor = lastKey.SK
    }

    // 相手の既読位置を取得
    if (otherUserId) {
      const otherMember = await client.send(new GetItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ PK: `USER#${otherUserId}`, SK: `CONV_MEMBER#${conversationId}` }),
        ProjectionExpression: 'lastReadAt',
      }))
      if (otherMember.Item) {
        const otherRecord = unmarshall(otherMember.Item)
        responseBody.otherLastReadAt = otherRecord.lastReadAt ?? null
      }
    }

    return response(200, responseBody)
  } catch (error) {
    console.error('メッセージ一覧取得エラー:', error)
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
