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
 * 拡張機能からの会議イベントを処理:
 * 1. 字幕バッチ: { themeId, entries } → DynamoDB 保存 + WebSocket 配信
 * 2. 会議開始通知: { action: 'meeting_started', themeId, themeName } → WebSocket のみ
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

    // 会議開始通知（WebSocket push のみ、DynamoDB 保存なし）
    if (body.action === 'meeting_started') {
      const { themeId, themeName } = body as { themeId: string; themeName: string }
      if (!themeId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'themeId is required' }) }
      }

      if (WS_ENDPOINT) {
        await pushToUser(userId, JSON.stringify({
          type: 'meeting_started',
          themeId,
          themeName: themeName || 'Meeting',
        }))
      }

      console.log(`[Meeting] meeting_started notification sent for theme ${themeId}`)
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) }
    }

    // 会議終了通知（WebSocket push のみ）
    if (body.action === 'meeting_ended') {
      const { themeId, totalEntries } = body as { themeId: string; totalEntries?: number }
      if (!themeId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'themeId is required' }) }
      }

      if (WS_ENDPOINT) {
        await pushToUser(userId, JSON.stringify({
          type: 'meeting_ended',
          themeId,
          totalEntries: totalEntries ?? 0,
        }))
      }

      console.log(`[Meeting] meeting_ended notification sent for theme ${themeId} (${totalEntries ?? 0} entries)`)
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) }
    }

    // 字幕バッチ処理
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
      await pushToUser(userId, JSON.stringify({
        type: 'transcript_chunk',
        themeId,
        startTime,
        endTime,
        entries: validEntries,
      }))
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

/** WebSocket でユーザーの全接続にメッセージを送信 */
async function pushToUser(userId: string, payload: string): Promise<void> {
  try {
    const connectionIds = await getUserConnectionIds(userId)
    if (connectionIds.length === 0) return

    const wsClient = new ApiGatewayManagementApiClient({ endpoint: WS_ENDPOINT })
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
    console.log(`[Meeting] Pushed to ${connectionIds.length} connections`)
  } catch (wsErr) {
    console.error('[Meeting] WebSocket push error:', wsErr)
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
