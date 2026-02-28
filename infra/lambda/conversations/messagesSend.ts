import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand, QueryCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import * as crypto from 'crypto'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT

/**
 * POST /conversations/{id}/messages — メッセージを送信
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
    const { content, senderName } = JSON.parse(event.body)

    if (!content || typeof content !== 'string') {
      return response(400, { error: 'content is required' })
    }
    if (!senderName || typeof senderName !== 'string') {
      return response(400, { error: 'senderName is required' })
    }

    // 参加者であることを確認
    const membership = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ PK: `USER#${userId}`, SK: `CONV_MEMBER#${conversationId}` }),
    }))

    if (!membership.Item) {
      return response(403, { error: 'この会話へのアクセス権がありません' })
    }

    // 会話メタデータから参加者を取得
    const metaResult = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ PK: `CONV#${conversationId}`, SK: 'META' }),
    }))

    if (!metaResult.Item) {
      return response(404, { error: '会話が見つかりません' })
    }

    const meta = unmarshall(metaResult.Item)
    const participants: string[] = meta.participants

    const now = Date.now()
    const paddedNow = String(now).padStart(15, '0')
    const messageId = crypto.randomUUID()

    const message = {
      id: messageId,
      senderId: userId,
      senderName,
      content,
      timestamp: now,
      type: 'text' as const,
    }

    // メッセージを保存
    await client.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        PK: `CONV#${conversationId}`,
        SK: `CMSG#${paddedNow}#${messageId}`,
        ...message,
      }),
    }))

    // 全参加者の CONV_MEMBER を更新（updatedAt, lastMessage, GSI2SK）
    const updatePromises = participants.map((participantId) =>
      client.send(new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ PK: `USER#${participantId}`, SK: `CONV_MEMBER#${conversationId}` }),
        UpdateExpression: 'SET updatedAt = :now, lastMessage = :msg, GSI2SK = :gsi2sk',
        ExpressionAttributeValues: marshall({
          ':now': now,
          ':msg': content.substring(0, 100),
          ':gsi2sk': `CONV_UPDATED#${paddedNow}`,
        }),
      }))
    )

    await Promise.all(updatePromises)

    // WebSocket リアルタイムプッシュ
    if (WEBSOCKET_ENDPOINT) {
      const wsClient = new ApiGatewayManagementApiClient({ endpoint: WEBSOCKET_ENDPOINT })

      // 各参加者の WebSocket 接続を取得
      const connectionPromises = participants.map(async (participantId) => {
        const result = await client.send(new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
          ExpressionAttributeValues: marshall({
            ':pk': `USER#${participantId}`,
            ':sk': 'WS_CONN#',
          }),
        }))
        return { participantId, connections: (result.Items || []).map((item) => unmarshall(item)) }
      })

      const participantConnections = await Promise.all(connectionPromises)

      const pushPromises: Promise<void>[] = []

      for (const { participantId, connections } of participantConnections) {
        for (const conn of connections) {
          const connectionId = conn.connectionId as string

          // 送信者以外には新着メッセージを通知
          if (participantId !== userId) {
            pushPromises.push(
              postToConnection(wsClient, connectionId, {
                type: 'new_message',
                conversationId,
                message,
              })
            )
          }

          // 全参加者に会話更新を通知
          pushPromises.push(
            postToConnection(wsClient, connectionId, {
              type: 'conversation_updated',
              conversationId,
              lastMessage: content.substring(0, 100),
              updatedAt: now,
            })
          )
        }
      }

      // プッシュ失敗はメッセージ送信に影響させない
      await Promise.allSettled(pushPromises)
    }

    return response(200, { message })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    console.error('メッセージ送信エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}

/**
 * WebSocket 接続にメッセージを送信する
 * 接続が切れている場合（GoneException / 410）は接続レコードを削除する
 */
async function postToConnection(wsClient: ApiGatewayManagementApiClient, connectionId: string, data: unknown): Promise<void> {
  try {
    await wsClient.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: new TextEncoder().encode(JSON.stringify(data)),
    }))
  } catch (err: any) {
    if (err.statusCode === 410 || err.name === 'GoneException') {
      // 切断済みの接続レコードを削除
      await client.send(new DeleteItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ PK: `WS_CONN#${connectionId}`, SK: 'META' }),
      }))
    } else {
      console.error(`WebSocket プッシュ失敗 (connectionId=${connectionId}):`, err)
    }
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
