import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * WebSocket $connect ハンドラー
 * 認証済みユーザーの接続情報を DynamoDB に保存する
 */
export const handler = async (event: any) => {
  const userId = event.requestContext.authorizer?.userId
  const connectionId = event.requestContext.connectionId

  if (!userId || !connectionId) {
    return { statusCode: 400, body: 'Missing userId or connectionId' }
  }

  // 接続レコードを保存（TTL: 2時間）
  await client.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall({
      PK: `WS_CONN#${connectionId}`,
      SK: 'META',
      userId,
      connectionId,
      connectedAt: Date.now(),
      ttlExpiry: Math.floor(Date.now() / 1000) + 7200,
      GSI1PK: `USER#${userId}`,
      GSI1SK: `WS_CONN#${connectionId}`,
    }),
  }))

  return { statusCode: 200, body: 'Connected' }
}
