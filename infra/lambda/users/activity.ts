import { DynamoDBClient, UpdateItemCommand, QueryCommand, GetItemCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { extractSessionStarts, analyzePattern, recomputeConfidence } from './activityPatternAnalyzer'
import type { SessionStart, BriefingWindow } from './activityPatternAnalyzer'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/** 30日（秒） */
const TTL_DAYS = 30

/** パターン分析に使う日数（曜日別分析のため4週間） */
const ANALYSIS_DAYS = 28

/** 分単位タイムスタンプの正規表現（YYYY-MM-DDTHH:mm） */
const MINUTE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

/** "HH:mm" の正規表現 */
const TIME_REGEX = /^\d{2}:\d{2}$/

/**
 * アクティビティパターンのレスポンス型
 *
 * dayWindows: 曜日別ブリーフィングウィンドウ（キー: "0"=日〜"6"=土）
 */
interface ActivityPatternResponse {
  dayWindows: Record<string, BriefingWindow[]>
  analyzedDays: number
  activeDays: number
  updatedAt: string
}

/** ブリーフィング発火記録 */
interface TriggeredWindow {
  windowFrom: string
  windowTo: string
  firedAt: string
}

/**
 * /users/activity — アクティビティ管理
 *
 * POST: アクティビティログをバッチ保存
 * GET:  アクティビティパターン（ブリーフィングウィンドウ）を取得
 *
 * /users/activity/briefing — ブリーフィング発火履歴
 * GET:  今日の発火履歴を取得
 * POST: 発火を記録
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  const method = event.httpMethod ?? event.requestContext.httpMethod
  const action = event.queryStringParameters?.action

  // ブリーフィング発火履歴: GET ?action=briefing / POST ?action=briefing
  if (action === 'briefing') {
    if (method === 'GET') return handleGetBriefingHistory(userId, event)
    if (method === 'POST') return handlePostBriefingFired(userId, event)
    return response(405, { error: 'Method not allowed' })
  }

  if (method === 'GET') {
    return handleGetPattern(userId)
  }
  return handlePostActivity(userId, event)
}

/**
 * GET /users/activity — アクティビティパターン取得
 *
 * 過去28日間のアクティビティデータからセッション開始パターンを曜日別に分析し、
 * 曜日ごとのブリーフィングウィンドウを返却する。
 */
async function handleGetPattern(userId: string): Promise<APIGatewayProxyResult> {
  try {
    const now = new Date()
    const startDate = new Date(now)
    startDate.setDate(startDate.getDate() - ANALYSIS_DAYS)
    const startSK = `ACTIVITY#${startDate.toISOString().slice(0, 10)}`
    const endSK = `ACTIVITY#${now.toISOString().slice(0, 10)}~`

    const result = await client.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${userId}` },
        ':start': { S: startSK },
        ':end': { S: endSK },
      },
    }))

    const items = result.Items ?? []

    if (items.length === 0) {
      return response(200, {
        dayWindows: {},
        analyzedDays: ANALYSIS_DAYS,
        activeDays: 0,
        updatedAt: now.toISOString(),
      } satisfies ActivityPatternResponse)
    }

    // 各日のアクティビティからセッション開始時刻を抽出
    const allStarts: SessionStart[] = []

    for (const item of items) {
      const record = unmarshall(item)
      const date = (record.SK as string).replace('ACTIVITY#', '')
      const minutes = record.activeMinutes
        ? Array.from(record.activeMinutes as Set<string>).sort()
        : []

      if (minutes.length === 0) continue
      allStarts.push(...extractSessionStarts(date, minutes))
    }

    // 全日統合でウィンドウ位置を決定
    const uniqueDays = new Set(
      items.map((item) => (unmarshall(item).SK as string).replace('ACTIVITY#', ''))
    )
    const baseWindows = analyzePattern(allStarts, uniqueDays.size)

    // 曜日別にグループ化（confidence 再計算用）
    const startsByDay = new Map<number, SessionStart[]>()
    const datesByDay = new Map<number, Set<string>>()

    for (const item of items) {
      const record = unmarshall(item)
      const date = (record.SK as string).replace('ACTIVITY#', '')
      const dow = new Date(date).getDay()
      if (!datesByDay.has(dow)) datesByDay.set(dow, new Set())
      datesByDay.get(dow)!.add(date)
    }

    for (const s of allStarts) {
      if (!startsByDay.has(s.dayOfWeek)) startsByDay.set(s.dayOfWeek, [])
      startsByDay.get(s.dayOfWeek)!.push(s)
    }

    // 各曜日でウィンドウ位置を共有しつつ confidence を個別算出
    const dayWindows: Record<string, BriefingWindow[]> = {}
    if (baseWindows.length > 0) {
      for (let dow = 0; dow < 7; dow++) {
        const dayStarts = startsByDay.get(dow) ?? []
        const dayCount = datesByDay.get(dow)?.size ?? 0
        dayWindows[String(dow)] = recomputeConfidence(baseWindows, dayStarts, dayCount)
      }
    }

    const patternResponse: ActivityPatternResponse = {
      dayWindows,
      analyzedDays: ANALYSIS_DAYS,
      activeDays: items.length,
      updatedAt: now.toISOString(),
    }

    return response(200, patternResponse)
  } catch (error) {
    console.error('アクティビティパターン分析エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}

/**
 * POST /users/activity — アクティビティログをバッチ保存
 */
async function handlePostActivity(userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (!event.body) {
    return response(400, { error: 'Request body is required' })
  }

  try {
    const { activeMinutes } = JSON.parse(event.body) as { activeMinutes?: string[] }

    if (!Array.isArray(activeMinutes) || activeMinutes.length === 0) {
      return response(400, { error: 'activeMinutes must be a non-empty array' })
    }

    // バリデーション + 日付ごとにグループ化
    const byDate = new Map<string, string[]>()
    for (const minute of activeMinutes) {
      if (typeof minute !== 'string' || !MINUTE_REGEX.test(minute)) continue
      const date = minute.slice(0, 10)
      const existing = byDate.get(date)
      if (existing) {
        existing.push(minute)
      } else {
        byDate.set(date, [minute])
      }
    }

    if (byDate.size === 0) {
      return response(400, { error: 'No valid activeMinutes provided' })
    }

    const ttlEpoch = Math.floor(Date.now() / 1000) + TTL_DAYS * 24 * 60 * 60
    const errors: string[] = []

    await Promise.all(
      Array.from(byDate.entries()).map(async ([date, minutes]) => {
        try {
          await client.send(new UpdateItemCommand({
            TableName: TABLE_NAME,
            Key: {
              PK: { S: `USER#${userId}` },
              SK: { S: `ACTIVITY#${date}` },
            },
            UpdateExpression: 'ADD activeMinutes :newMinutes SET #ttl = :ttl',
            ExpressionAttributeNames: {
              '#ttl': 'ttlExpiry',
            },
            ExpressionAttributeValues: {
              ':newMinutes': { SS: minutes },
              ':ttl': { N: String(ttlEpoch) },
            },
          }))
        } catch (err) {
          console.error(`アクティビティ保存エラー (${date}):`, err)
          errors.push(date)
        }
      })
    )

    if (errors.length > 0) {
      return response(207, { success: true, partialErrors: errors })
    }

    return response(200, { success: true })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    console.error('アクティビティ保存エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}

/**
 * GET /users/activity/briefing — 今日の発火履歴を取得
 */
async function handleGetBriefingHistory(userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const date = event.queryStringParameters?.date ?? new Date().toISOString().slice(0, 10)

    const result = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: `BRIEFING#${date}` },
      },
    }))

    const triggeredWindows: TriggeredWindow[] = []
    if (result.Item) {
      const record = unmarshall(result.Item)
      if (Array.isArray(record.triggeredWindows)) {
        triggeredWindows.push(...record.triggeredWindows)
      }
    }

    return response(200, { date, triggeredWindows })
  } catch (error) {
    console.error('ブリーフィング履歴取得エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}

/**
 * POST /users/activity/briefing — 発火を記録
 *
 * GET→存在チェック→条件付き追記で同一ウィンドウの重複記録を防止
 */
async function handlePostBriefingFired(userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (!event.body) {
    return response(400, { error: 'Request body is required' })
  }

  try {
    const { windowFrom, windowTo } = JSON.parse(event.body) as { windowFrom?: string; windowTo?: string }

    if (!windowFrom || !windowTo || !TIME_REGEX.test(windowFrom) || !TIME_REGEX.test(windowTo)) {
      return response(400, { error: 'windowFrom and windowTo must be "HH:mm" format' })
    }

    const today = new Date().toISOString().slice(0, 10)
    const sk = `BRIEFING#${today}`
    const firedAt = new Date().toISOString()
    const ttlEpoch = Math.floor(Date.now() / 1000) + TTL_DAYS * 24 * 60 * 60

    // 既存レコードを取得して重複チェック
    const existing = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: sk },
      },
    }))

    let triggeredWindows: TriggeredWindow[] = []
    if (existing.Item) {
      const record = unmarshall(existing.Item)
      if (Array.isArray(record.triggeredWindows)) {
        triggeredWindows = record.triggeredWindows
      }
    }

    // 同一ウィンドウが既に記録済みかチェック
    const alreadyTriggered = triggeredWindows.some(
      (w) => w.windowFrom === windowFrom && w.windowTo === windowTo
    )
    if (alreadyTriggered) {
      return response(200, { success: true, alreadyTriggered: true })
    }

    // 新しいウィンドウを追記
    triggeredWindows.push({ windowFrom, windowTo, firedAt })

    await client.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: sk },
      },
      UpdateExpression: 'SET triggeredWindows = :tw, #ttl = :ttl',
      ExpressionAttributeNames: {
        '#ttl': 'ttlExpiry',
      },
      ExpressionAttributeValues: {
        ':tw': { S: JSON.stringify(triggeredWindows) },
        ':ttl': { N: String(ttlEpoch) },
      },
    }))

    return response(200, { success: true, alreadyTriggered: false })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    console.error('ブリーフィング発火記録エラー:', error)
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
