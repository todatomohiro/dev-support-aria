import { DynamoDBClient, QueryCommand, GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * POST /friends/link — ユーザーコードでフレンドリンク（双方向フレンドのみ）
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
    const { code, displayName } = JSON.parse(event.body)

    if (!code || typeof code !== 'string') {
      return response(400, { error: 'code is required' })
    }
    if (!displayName || typeof displayName !== 'string') {
      return response(400, { error: 'displayName is required' })
    }

    // コード所有者を GSI1 で検索
    const codeResult = await client.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
      ExpressionAttributeValues: {
        ':pk': { S: `USER_CODE#${code.toUpperCase()}` },
        ':sk': { S: 'USER_CODE' },
      },
      Limit: 1,
    }))

    const codeItems = codeResult.Items ?? []
    if (codeItems.length === 0) {
      return response(404, { error: '無効なユーザーコードです' })
    }

    const codeRecord = unmarshall(codeItems[0])
    const friendUserId = codeRecord.PK.replace('USER#', '')

    // 自分自身へのリンクを防止
    if (friendUserId === userId) {
      return response(400, { error: '自分自身とフレンドになることはできません' })
    }

    // コード所有者の設定からニックネームを取得
    const friendSettingsResult = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ PK: `USER#${friendUserId}`, SK: 'SETTINGS' }),
    }))
    const friendDisplayName = friendSettingsResult.Item
      ? ((unmarshall(friendSettingsResult.Item).data?.profile?.nickname as string) || 'ユーザー')
      : 'ユーザー'

    // 既にフレンドかチェック
    const existingFriend = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ PK: `USER#${userId}`, SK: `FRIEND#${friendUserId}` }),
    }))

    if (existingFriend.Item) {
      return response(409, { error: '既にフレンドです' })
    }

    const now = Date.now()

    // トランザクションで双方向フレンドレコードのみ作成（コードは消費しない）
    await client.send(new TransactWriteItemsCommand({
      TransactItems: [
        // 自分側のフレンドレコード（相手のニックネームを表示名に）
        {
          Put: {
            TableName: TABLE_NAME,
            Item: marshall({
              PK: `USER#${userId}`,
              SK: `FRIEND#${friendUserId}`,
              friendUserId,
              displayName: friendDisplayName,
              linkedAt: now,
            }),
          },
        },
        // 相手側のフレンドレコード
        {
          Put: {
            TableName: TABLE_NAME,
            Item: marshall({
              PK: `USER#${friendUserId}`,
              SK: `FRIEND#${userId}`,
              friendUserId: userId,
              displayName,
              linkedAt: now,
            }),
          },
        },
      ],
    }))

    return response(200, { friendUserId })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    console.error('フレンドリンクエラー:', error)
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
