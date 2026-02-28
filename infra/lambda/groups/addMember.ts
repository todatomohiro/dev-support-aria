import { DynamoDBClient, GetItemCommand, UpdateItemCommand, PutItemCommand, QueryCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT

/**
 * POST /groups/{id}/members — グループにメンバーを追加
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

  if (!event.body) {
    return response(400, { error: 'Request body is required' })
  }

  try {
    const body = JSON.parse(event.body)
    let targetUserId: string | undefined = body.userId
    const userCode: string | undefined = body.userCode

    // userCode が指定されている場合は GSI1 で userId を解決
    if (!targetUserId && userCode) {
      const codeResult = await client.send(new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
        ExpressionAttributeValues: {
          ':pk': { S: `USER_CODE#${userCode.toUpperCase()}` },
          ':sk': { S: 'USER_CODE' },
        },
        Limit: 1,
      }))
      const codeItems = codeResult.Items ?? []
      if (codeItems.length === 0) {
        return response(404, { error: '無効なユーザーコードです' })
      }
      targetUserId = unmarshall(codeItems[0]).PK.replace('USER#', '')
    }

    if (!targetUserId) {
      return response(400, { error: 'userId or userCode is required' })
    }

    // 自分がグループのメンバーか確認
    const membership = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ PK: `USER#${userId}`, SK: `CONV_MEMBER#${groupId}` }),
    }))
    if (!membership.Item) {
      return response(403, { error: 'このグループへのアクセス権がありません' })
    }

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

    // 既にメンバーかチェック
    if (participants.includes(targetUserId)) {
      return response(409, { error: '既にメンバーです' })
    }

    const now = Date.now()
    const paddedNow = String(now).padStart(15, '0')
    const groupName = meta.groupName as string

    // META の participants[] を更新
    await client.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ PK: `CONV#${groupId}`, SK: 'META' }),
      UpdateExpression: 'SET participants = list_append(participants, :newMember), updatedAt = :now',
      ExpressionAttributeValues: marshall({
        ':newMember': [targetUserId],
        ':now': now,
      }),
    }))

    // 新メンバーの CONV_MEMBER# を作成
    await client.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        PK: `USER#${targetUserId}`,
        SK: `CONV_MEMBER#${groupId}`,
        conversationId: groupId,
        groupName,
        updatedAt: now,
        GSI2PK: `USER#${targetUserId}`,
        GSI2SK: `CONV_UPDATED#${paddedNow}`,
      }),
    }))

    // 追加したユーザーのニックネームを取得
    const targetSettingsResult = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ PK: `USER#${targetUserId}`, SK: 'SETTINGS' }),
    }))
    const targetNickname = targetSettingsResult.Item
      ? ((unmarshall(targetSettingsResult.Item).data?.profile?.nickname as string) || 'ユーザー')
      : 'ユーザー'

    // WebSocket 通知（既存メンバーに member_added イベントを送信）
    if (WEBSOCKET_ENDPOINT) {
      const wsClient = new ApiGatewayManagementApiClient({ endpoint: WEBSOCKET_ENDPOINT })
      const pushPromises: Promise<void>[] = []

      for (const participantId of participants) {
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
              type: 'member_added',
              groupId,
              userId: targetUserId,
              nickname: targetNickname,
            })
          )
        }
      }
      await Promise.allSettled(pushPromises)
    }

    return response(200, { success: true, userId: targetUserId, nickname: targetNickname })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    console.error('メンバー追加エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
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
