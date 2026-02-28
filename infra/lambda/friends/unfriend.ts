import { DynamoDBClient, QueryCommand, GetItemCommand, TransactWriteItemsCommand, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * DELETE /friends/{friendUserId} — フレンド解除（双方向フレンド + 会話 + メッセージ全削除）
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  const friendUserId = event.pathParameters?.friendUserId
  if (!friendUserId) {
    return response(400, { error: 'friendUserId is required' })
  }

  try {
    // フレンドレコードの存在を確認
    const friendRecord = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ PK: `USER#${userId}`, SK: `FRIEND#${friendUserId}` }),
    }))

    if (!friendRecord.Item) {
      return response(404, { error: 'フレンドが見つかりません' })
    }

    // 会話 ID を算出
    const conversationId = [userId, friendUserId].sort().join('_')

    // 会話メッセージを全取得して BatchWrite で削除
    await deleteAllMessages(conversationId)

    // 構造レコード5件をトランザクションで一括削除
    await client.send(new TransactWriteItemsCommand({
      TransactItems: [
        // 自分側フレンドレコード
        {
          Delete: {
            TableName: TABLE_NAME,
            Key: marshall({ PK: `USER#${userId}`, SK: `FRIEND#${friendUserId}` }),
          },
        },
        // 相手側フレンドレコード
        {
          Delete: {
            TableName: TABLE_NAME,
            Key: marshall({ PK: `USER#${friendUserId}`, SK: `FRIEND#${userId}` }),
          },
        },
        // 自分側会話メンバーシップ
        {
          Delete: {
            TableName: TABLE_NAME,
            Key: marshall({ PK: `USER#${userId}`, SK: `CONV_MEMBER#${conversationId}` }),
          },
        },
        // 相手側会話メンバーシップ
        {
          Delete: {
            TableName: TABLE_NAME,
            Key: marshall({ PK: `USER#${friendUserId}`, SK: `CONV_MEMBER#${conversationId}` }),
          },
        },
        // 会話メタデータ
        {
          Delete: {
            TableName: TABLE_NAME,
            Key: marshall({ PK: `CONV#${conversationId}`, SK: 'META' }),
          },
        },
      ],
    }))

    return response(200, { success: true })
  } catch (error) {
    console.error('フレンド解除エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}

/**
 * 会話メッセージを全て削除（25件ずつ BatchWriteItem）
 */
async function deleteAllMessages(conversationId: string): Promise<void> {
  let lastEvaluatedKey: Record<string, { S: string }> | undefined

  do {
    const result = await client.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `CONV#${conversationId}` },
        ':skPrefix': { S: 'CMSG#' },
      },
      ProjectionExpression: 'PK, SK',
      ExclusiveStartKey: lastEvaluatedKey,
    }))

    const items = result.Items ?? []
    if (items.length === 0) break

    // 25件ずつバッチ削除
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25)
      await client.send(new BatchWriteItemCommand({
        RequestItems: {
          [TABLE_NAME]: batch.map((item) => ({
            DeleteRequest: {
              Key: {
                PK: item.PK!,
                SK: item.SK!,
              },
            },
          })),
        },
      }))
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, { S: string }> | undefined
  } while (lastEvaluatedKey)
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
