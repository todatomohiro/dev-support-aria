import { DynamoDBClient, DeleteItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * WebSocket $disconnect ハンドラー
 * 切断された接続レコードを DynamoDB から削除する
 */
export const handler = async (event: any) => {
  const connectionId = event.requestContext.connectionId

  if (!connectionId) {
    return { statusCode: 400, body: 'Missing connectionId' }
  }

  // 接続レコードを削除
  await client.send(new DeleteItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({
      PK: `WS_CONN#${connectionId}`,
      SK: 'META',
    }),
  }))

  return { statusCode: 200, body: 'Disconnected' }
}
