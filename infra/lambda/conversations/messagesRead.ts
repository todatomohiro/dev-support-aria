import { DynamoDBClient, GetItemCommand, UpdateItemCommand, QueryCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT

/**
 * POST /conversations/{id}/messages/read — 既読位置を更新
 *
 * リクエストボディ: { lastReadAt: number }
 * - CONV_MEMBER レコードの lastReadAt を更新（後退防止）
 * - 相手の WebSocket 接続に message_read イベントを push
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

  if (!event.body) {
    return response(400, { error: 'Request body is required' })
  }

  try {
    const { lastReadAt } = JSON.parse(event.body)

    if (typeof lastReadAt !== 'number' || lastReadAt <= 0) {
      return response(400, { error: 'lastReadAt must be a positive number' })
    }

    // 参加者であることを確認
    const memberKey = { PK: `USER#${userId}`, SK: `CONV_MEMBER#${conversationId}` }
    const membership = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall(memberKey),
    }))

    if (!membership.Item) {
      return response(403, { error: 'この会話へのアクセス権がありません' })
    }

    const member = unmarshall(membership.Item)

    // 後退防止: 現在値より大きい場合のみ更新
    if (member.lastReadAt && member.lastReadAt >= lastReadAt) {
      return response(200, { updated: false })
    }

    // lastReadAt を更新
    await client.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall(memberKey),
      UpdateExpression: 'SET lastReadAt = :lastReadAt',
      ExpressionAttributeValues: marshall({ ':lastReadAt': lastReadAt }),
    }))

    // 会話メタデータから参加者を取得し、相手を特定
    const metaResult = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ PK: `CONV#${conversationId}`, SK: 'META' }),
    }))

    if (metaResult.Item) {
      const meta = unmarshall(metaResult.Item)
      const participants: string[] = meta.participants
      const otherParticipants = participants.filter((p) => p !== userId)

      // 相手の WebSocket 接続に既読通知を送信
      if (WEBSOCKET_ENDPOINT && otherParticipants.length > 0) {
        const wsClient = new ApiGatewayManagementApiClient({ endpoint: WEBSOCKET_ENDPOINT })

        for (const otherUserId of otherParticipants) {
          const connResult = await client.send(new QueryCommand({
            TableName: TABLE_NAME,
            IndexName: 'GSI1',
            KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
            ExpressionAttributeValues: marshall({
              ':pk': `USER#${otherUserId}`,
              ':sk': 'WS_CONN#',
            }),
          }))

          const connections = (connResult.Items || []).map((item) => unmarshall(item))

          for (const conn of connections) {
            const connectionId = conn.connectionId as string
            try {
              await wsClient.send(new PostToConnectionCommand({
                ConnectionId: connectionId,
                Data: new TextEncoder().encode(JSON.stringify({
                  type: 'message_read',
                  conversationId,
                  userId,
                  lastReadAt,
                })),
              }))
            } catch (err: any) {
              if (err.statusCode === 410 || err.name === 'GoneException') {
                await client.send(new DeleteItemCommand({
                  TableName: TABLE_NAME,
                  Key: marshall({ PK: `WS_CONN#${connectionId}`, SK: 'META' }),
                }))
              } else {
                console.error(`WebSocket プッシュ失敗 (connectionId=${connectionId}):`, err)
              }
            }
          }
        }
      }
    }

    return response(200, { updated: true })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    console.error('既読更新エラー:', error)
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
