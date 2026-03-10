import { DynamoDBClient, UpdateItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { extractSessionStarts, analyzePattern } from './activityPatternAnalyzer'
import type { SessionStart, BriefingWindow } from './activityPatternAnalyzer'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/** 30日（秒） */
const TTL_DAYS = 30

/** パターン分析に使う日数 */
const ANALYSIS_DAYS = 14

/** 分単位タイムスタンプの正規表現（YYYY-MM-DDTHH:mm） */
const MINUTE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

/**
 * アクティビティパターンのレスポンス型
 */
interface ActivityPatternResponse {
  weekday: BriefingWindow[]
  weekend: BriefingWindow[]
  analyzedDays: number
  activeDays: number
  updatedAt: string
}

/**
 * /users/activity — アクティビティ管理
 *
 * POST: アクティビティログをバッチ保存
 * GET:  アクティビティパターン（ブリーフィングウィンドウ）を取得
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  const method = event.httpMethod ?? event.requestContext.httpMethod
  if (method === 'GET') {
    return handleGetPattern(userId)
  }
  return handlePostActivity(userId, event)
}

/**
 * GET /users/activity — アクティビティパターン取得
 *
 * 過去14日間のアクティビティデータからセッション開始パターンを分析し、
 * ブリーフィングウィンドウを返却する。
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
        weekday: [],
        weekend: [],
        analyzedDays: ANALYSIS_DAYS,
        activeDays: 0,
        updatedAt: now.toISOString(),
      } satisfies ActivityPatternResponse)
    }

    // 各日のアクティビティからセッション開始時刻を抽出
    const sessionStarts: SessionStart[] = []

    for (const item of items) {
      const record = unmarshall(item)
      const date = (record.SK as string).replace('ACTIVITY#', '')
      const minutes = record.activeMinutes
        ? Array.from(record.activeMinutes as Set<string>).sort()
        : []

      if (minutes.length === 0) continue
      sessionStarts.push(...extractSessionStarts(date, minutes))
    }

    // 平日・休日に分離してパターン分析
    const weekdayStarts = sessionStarts.filter((s) => s.dayOfWeek >= 1 && s.dayOfWeek <= 5)
    const weekendStarts = sessionStarts.filter((s) => s.dayOfWeek === 0 || s.dayOfWeek === 6)

    const dateStrings = items.map((item) => (unmarshall(item).SK as string).replace('ACTIVITY#', ''))
    const weekdayDays = new Set(dateStrings.filter((d) => { const dow = new Date(d).getDay(); return dow >= 1 && dow <= 5 }))
    const weekendDays = new Set(dateStrings.filter((d) => { const dow = new Date(d).getDay(); return dow === 0 || dow === 6 }))

    const patternResponse: ActivityPatternResponse = {
      weekday: analyzePattern(weekdayStarts, weekdayDays.size),
      weekend: analyzePattern(weekendStarts, weekendDays.size),
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
