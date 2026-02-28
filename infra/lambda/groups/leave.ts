import { DynamoDBClient, GetItemCommand, UpdateItemCommand, DeleteItemCommand, PutItemCommand, QueryCommand, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import * as crypto from 'crypto'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT

/**
 * DELETE /groups/{id}/members/me — グループを退出
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  const groupId = event.pathParameters?.id
  if (!groupId) {
    return response(400, { error: 'groupId is required' })
  }

  try {
    // グループメタデータを取得
    const metaResult = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ PK: `CONV#${groupId}`, SK: 'META' }),
    }))
    if (!metaResult.Item) {
      return response(404, { error: 'グループが見つかりません' })
    }
    const meta = unmarshall(metaResult.Item)
    const participants: string[] = meta.participants

    if (!participants.includes(userId)) {
      return response(403, { error: 'このグループのメンバーではありません' })
    }

    // 自分の CONV_MEMBER# を削除
    await client.send(new DeleteItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ PK: `USER#${userId}`, SK: `CONV_MEMBER#${groupId}` }),
    }))

    const remainingParticipants = participants.filter((p) => p !== userId)

    if (remainingParticipants.length === 0) {
      // 最後の1人 → グループ全削除（META + メッセージ）
      await deleteAllMessages(groupId)
      await client.send(new DeleteItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ PK: `CONV#${groupId}`, SK: 'META' }),
      }))
    } else {
      // META から自分を除外
      await client.send(new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ PK: `CONV#${groupId}`, SK: 'META' }),
        UpdateExpression: 'SET participants = :remaining, updatedAt = :now',
        ExpressionAttributeValues: marshall({
          ':remaining': remainingParticipants,
          ':now': Date.now(),
        }),
      }))

      // 退出したユーザーのニックネームを取得
      const settingsResult = await client.send(new GetItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ PK: `USER#${userId}`, SK: 'SETTINGS' }),
      }))
      const nickname = settingsResult.Item
        ? ((unmarshall(settingsResult.Item).data?.profile?.nickname as string) || 'ユーザー')
        : 'ユーザー'

      const now = Date.now()
      const paddedNow = String(now).padStart(15, '0')
      const messageId = crypto.randomUUID()

      // システムメッセージを挿入
      await client.send(new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall({
          PK: `CONV#${groupId}`,
          SK: `CMSG#${paddedNow}#${messageId}`,
          id: messageId,
          senderId: 'system',
          senderName: 'システム',
          content: `${nickname} がグループを退出しました`,
          timestamp: now,
          type: 'system',
        }),
      }))

      // 残りメンバーの CONV_MEMBER を更新
      const updatePromises = remainingParticipants.map((participantId) =>
        client.send(new UpdateItemCommand({
          TableName: TABLE_NAME,
          Key: marshall({ PK: `USER#${participantId}`, SK: `CONV_MEMBER#${groupId}` }),
          UpdateExpression: 'SET updatedAt = :now, lastMessage = :msg, GSI2SK = :gsi2sk',
          ExpressionAttributeValues: marshall({
            ':now': now,
            ':msg': `${nickname} がグループを退出しました`,
            ':gsi2sk': `CONV_UPDATED#${paddedNow}`,
          }),
        }))
      )
      await Promise.all(updatePromises)

      // WebSocket 通知（残りメンバーに member_left イベントを送信）
      if (WEBSOCKET_ENDPOINT) {
        const wsClient = new ApiGatewayManagementApiClient({ endpoint: WEBSOCKET_ENDPOINT })
        const pushPromises: Promise<void>[] = []

        for (const participantId of remainingParticipants) {
          const connResult = await client.send(new QueryCommand({
            TableName: TABLE_NAME,
            IndexName: 'GSI1',
            KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
            ExpressionAttributeValues: marshall({
              ':pk': `USER#${participantId}`,
              ':sk': 'WS_CONN#',
            }),
          }))
          for (const item of connResult.Items ?? []) {
            const conn = unmarshall(item)
            pushPromises.push(
              postToConnection(wsClient, conn.connectionId as string, {
                type: 'member_left',
                groupId,
                userId,
                nickname,
              })
            )
          }
        }
        await Promise.allSettled(pushPromises)
      }
    }

    return response(200, { success: true })
  } catch (error) {
    console.error('グループ退出エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}

/**
 * 会話メッセージを全て削除（25件ずつ BatchWriteItem）
 */
async function deleteAllMessages(groupId: string): Promise<void> {
  let lastEvaluatedKey: Record<string, { S: string }> | undefined

  do {
    const result = await client.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `CONV#${groupId}` },
        ':skPrefix': { S: 'CMSG#' },
      },
      ProjectionExpression: 'PK, SK',
      ExclusiveStartKey: lastEvaluatedKey,
    }))

    const items = result.Items ?? []
    if (items.length === 0) break

    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25)
      await client.send(new BatchWriteItemCommand({
        RequestItems: {
          [TABLE_NAME]: batch.map((item) => ({
            DeleteRequest: {
              Key: { PK: item.PK!, SK: item.SK! },
            },
          })),
        },
      }))
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, { S: string }> | undefined
  } while (lastEvaluatedKey)
}

/**
 * WebSocket 接続にメッセージを送信する
 */
async function postToConnection(wsClient: ApiGatewayManagementApiClient, connectionId: string, data: unknown): Promise<void> {
  try {
    await wsClient.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: new TextEncoder().encode(JSON.stringify(data)),
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
