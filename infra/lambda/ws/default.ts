import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi'
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

const dynamo = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!
const WS_ENDPOINT = process.env.WEBSOCKET_ENDPOINT!

const wsClient = new ApiGatewayManagementApiClient({ endpoint: WS_ENDPOINT })

/**
 * WebSocket $default ルートハンドラー
 *
 * クライアントから送信されたメッセージを受け取り、種別に応じて中継する。
 * 主にターミナル共有機能で使用。
 */
export const handler = async (event: any) => {
  const connectionId: string = event.requestContext.connectionId
  const body = JSON.parse(event.body ?? '{}')
  const type: string = body.type

  // 送信元の userId を取得
  const connResult = await dynamo.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ PK: `WS_CONN#${connectionId}`, SK: 'META' }),
  }))
  const userId = connResult.Item?.userId?.S
  if (!userId) {
    console.warn(`[WsDefault] userId not found for connId=${connectionId}`)
    return { statusCode: 403, body: 'Unknown connection' }
  }

  console.log(`[WsDefault] type=${type}, userId=${userId}`)

  switch (type) {
    case 'terminal_start':
      return handleTerminalStart(userId, connectionId, body.sessionId)
    case 'terminal_stop':
      return handleTerminalStop(userId)
    case 'terminal_output':
      return handleTerminalOutput(userId, connectionId, body.data)
    case 'terminal_input':
      return handleTerminalInput(userId, connectionId, body.data)
    default:
      console.log(`[WsDefault] unknown type: ${type}`)
      return { statusCode: 200, body: 'ignored' }
  }
}

/**
 * ターミナルセッション開始（PC → Server）
 * ホストの connectionId を DynamoDB に登録
 */
async function handleTerminalStart(userId: string, connectionId: string, sessionId: string) {
  await dynamo.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall({
      PK: `USER#${userId}`,
      SK: 'TERMINAL_SESSION',
      hostConnectionId: connectionId,
      sessionId: sessionId ?? `term-${Date.now()}`,
      createdAt: new Date().toISOString(),
      ttlExpiry: Math.floor(Date.now() / 1000) + 86400,
    }),
  }))

  console.log(`[WsDefault] terminal_start: userId=${userId}, host=${connectionId}`)
  return { statusCode: 200, body: 'terminal started' }
}

/**
 * ターミナルセッション終了（PC → Server）
 */
async function handleTerminalStop(userId: string) {
  await dynamo.send(new DeleteItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ PK: `USER#${userId}`, SK: 'TERMINAL_SESSION' }),
  }))

  console.log(`[WsDefault] terminal_stop: userId=${userId}`)
  return { statusCode: 200, body: 'terminal stopped' }
}

/**
 * ターミナル出力の中継（PC → Server → スマホ）
 * ホスト以外の全接続に転送
 */
async function handleTerminalOutput(userId: string, senderConnectionId: string, data: string) {
  const connections = await getUserConnectionIds(userId)
  const targets = connections.filter((cid) => cid !== senderConnectionId)
  if (targets.length === 0) return { statusCode: 200, body: 'no targets' }

  const message = JSON.stringify({ type: 'terminal_output', data })
  await Promise.all(targets.map((cid) => pushToConnection(cid, message)))

  return { statusCode: 200, body: 'relayed' }
}

/**
 * ターミナル入力の中継（スマホ → Server → PC）
 * ホストの connectionId にのみ転送
 */
async function handleTerminalInput(userId: string, senderConnectionId: string, data: string) {
  const sessionResult = await dynamo.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ PK: `USER#${userId}`, SK: 'TERMINAL_SESSION' }),
  }))

  const hostConnectionId = sessionResult.Item?.hostConnectionId?.S
  if (!hostConnectionId || hostConnectionId === senderConnectionId) {
    return { statusCode: 200, body: 'no host' }
  }

  const message = JSON.stringify({ type: 'terminal_input', data })
  await pushToConnection(hostConnectionId, message)

  return { statusCode: 200, body: 'relayed' }
}

/** ユーザーの全 WebSocket 接続 ID を取得 */
async function getUserConnectionIds(userId: string): Promise<string[]> {
  const result = await dynamo.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
    ExpressionAttributeValues: marshall({
      ':pk': `USER#${userId}`,
      ':sk': 'WS_CONN#',
    }),
    ProjectionExpression: 'connectionId',
  }))

  return (result.Items ?? [])
    .map((item) => unmarshall(item).connectionId as string)
    .filter(Boolean)
}

/** WebSocket 接続にメッセージを送信。失敗時は接続レコードを削除し false を返す */
async function pushToConnection(connectionId: string, message: string): Promise<boolean> {
  try {
    await wsClient.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: new TextEncoder().encode(message),
    }))
    return true
  } catch (error: any) {
    console.warn(`[WsDefault] pushToConnection failed: connId=${connectionId}, error=${error.name}`)
    // 送信失敗した接続は古い可能性が高いので削除
    await dynamo.send(new DeleteItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ PK: `WS_CONN#${connectionId}`, SK: 'META' }),
    })).catch(() => {})
    return false
  }
}
