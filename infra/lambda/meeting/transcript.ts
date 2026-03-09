import { DynamoDBClient, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb'
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const db = new DynamoDBClient({})
const TABLE = process.env.TABLE_NAME || 'butler-assistant'
const WS_ENDPOINT = process.env.WEBSOCKET_ENDPOINT || ''

interface TranscriptEntry {
  speaker: string
  text: string
  timestamp: number
  source: string // 'mic' | 'caption'
}

/**
 * POST /meeting/transcript
 *
 * 拡張機能から字幕バッチを受信し、テーマのメッセージとして保存。
 * WebSocket で Ai-Ba アプリにリアルタイム配信する。
 *
 * Body: { themeId: string, entries: TranscriptEntry[] }
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  }

  try {
    const userId = event.requestContext.authorizer?.claims?.sub
    if (!userId) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) }
    }

    if (!event.body) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Body required' }) }
    }

    const body = JSON.parse(event.body)
    const { themeId, entries } = body as { themeId: string; entries: TranscriptEntry[] }

    if (!themeId || !entries?.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'themeId and entries are required' }) }
    }

    // 字幕エントリのバリデーション
    const validEntries = entries.filter((e) => e.text && e.timestamp)
    if (validEntries.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No valid entries' }) }
    }

    // 時間範囲を計算
    const timestamps = validEntries.map((e) => e.timestamp)
    const startTime = Math.min(...timestamps)
    const endTime = Math.max(...timestamps)
    const now = Date.now()

    // トランスクリプトメッセージとして DynamoDB に保存
    // role='transcript' のメッセージとして保存（通常の user/assistant とは区別）
    const content = JSON.stringify({
      __type: 'transcript',
      startTime,
      endTime,
      entries: validEntries.map((e) => ({
        speaker: e.speaker,
        text: e.text,
        timestamp: e.timestamp,
        source: e.source,
      })),
    })

    await db.send(new PutItemCommand({
      TableName: TABLE,
      Item: {
        PK: { S: `USER#${userId}#THEME#${themeId}` },
        SK: { S: `MSG#${startTime}#transcript` },
        id: { S: `tr-${startTime}-${endTime}` },
        role: { S: 'transcript' },
        content: { S: content },
        createdAt: { S: new Date(now).toISOString() },
      },
    }))

    console.log(`[Meeting] Saved ${validEntries.length} transcript entries for theme ${themeId}`)

    // WebSocket でリアルタイム配信
    if (WS_ENDPOINT) {
      try {
        const connectionIds = await getUserConnectionIds(userId)
        if (connectionIds.length > 0) {
          const wsClient = new ApiGatewayManagementApiClient({ endpoint: WS_ENDPOINT })
          const payload = JSON.stringify({
            type: 'transcript_chunk',
            themeId,
            startTime,
            endTime,
            entries: validEntries,
          })

          await Promise.allSettled(
            connectionIds.map(async (connId) => {
              try {
                await wsClient.send(new PostToConnectionCommand({
                  ConnectionId: connId,
                  Data: new TextEncoder().encode(payload),
                }))
              } catch (err: unknown) {
                const error = err as { statusCode?: number; name?: string }
                if (error.statusCode === 410 || error.name === 'GoneException') {
                  // 切断済み接続を削除
                  await db.send(new PutItemCommand({
                    TableName: TABLE,
                    Item: {
                      PK: { S: `WS_CONN#${connId}` },
                      SK: { S: 'META' },
                      ttlExpiry: { N: '0' },
                    },
                  })).catch(() => {})
                }
              }
            })
          )
          console.log(`[Meeting] Pushed transcript to ${connectionIds.length} connections`)
        }
      } catch (wsErr) {
        console.error('[Meeting] WebSocket push error:', wsErr)
        // WS エラーでもメイン処理は成功として返す
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ saved: validEntries.length }),
    }
  } catch (err) {
    console.error('[Meeting] Error:', err)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: (err as Error).message }),
    }
  }
}

/** ユーザーの全 WebSocket 接続 ID を取得 */
async function getUserConnectionIds(userId: string): Promise<string[]> {
  const result = await db.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': { S: `USER#${userId}` },
      ':sk': { S: 'WS_CONN#' },
    },
  }))
  return (result.Items ?? [])
    .map((item) => item.connectionId?.S)
    .filter((id): id is string => Boolean(id))
}
