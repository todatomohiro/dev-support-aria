import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { requireAdmin, isErrorResponse, response } from './middleware'
import { extractSessionStarts, analyzePattern, recomputeConfidence } from '../users/activityPatternAnalyzer'
import type { SessionStart, BriefingWindow } from '../users/activityPatternAnalyzer'

const dynamo = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/** パターン分析に使う日数（曜日別分析のため4週間） */
const ANALYSIS_DAYS = 28

/**
 * GET /admin/users/{userId}/activity — ユーザーアクティビティログ取得
 *
 * クエリパラメータ:
 *   days: 取得日数（デフォルト30、最大90）
 *
 * レスポンスに dayWindows（バックエンドと同一のパターン分析結果）を含む。
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const auth = await requireAdmin(event)
  if (isErrorResponse(auth)) return auth

  const targetUserId = event.pathParameters?.userId
  if (!targetUserId) {
    return response(400, { error: 'userId is required' })
  }

  const days = Math.min(parseInt(event.queryStringParameters?.days ?? '30', 10) || 30, 90)

  try {
    // 指定日数分の日付範囲を計算
    const now = new Date()
    const startDate = new Date(now)
    startDate.setDate(startDate.getDate() - days)
    const startSK = `ACTIVITY#${startDate.toISOString().slice(0, 10)}`
    const endSK = `ACTIVITY#${now.toISOString().slice(0, 10)}~` // ~ は ASCII で Z より後

    const result = await dynamo.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${targetUserId}` },
        ':start': { S: startSK },
        ':end': { S: endSK },
      },
    }))

    const items = result.Items ?? []

    // ACTIVITY レコードと BRIEFING レコードを分離
    const activityItems = items.filter((item) => {
      const record = unmarshall(item)
      return (record.SK as string).startsWith('ACTIVITY#')
    })

    const activities = activityItems.map((item) => {
      const record = unmarshall(item)
      return {
        date: (record.SK as string).replace('ACTIVITY#', ''),
        activeMinutes: record.activeMinutes ? Array.from(record.activeMinutes as Set<string>).sort() : [],
      }
    })

    // パターン分析（バックエンド /users/activity と同一ロジック）
    const dayWindows = computeDayWindows(activityItems)

    // ブリーフィング発火履歴を取得
    const briefingResult = await dynamo.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${targetUserId}` },
        ':start': { S: `BRIEFING#${startDate.toISOString().slice(0, 10)}` },
        ':end': { S: `BRIEFING#${now.toISOString().slice(0, 10)}~` },
      },
    }))

    const briefingHistory = (briefingResult.Items ?? []).map((item) => {
      const record = unmarshall(item)
      const date = (record.SK as string).replace('BRIEFING#', '')
      let triggeredWindows: { windowFrom: string; windowTo: string; firedAt: string }[] = []
      if (record.triggeredWindows) {
        try {
          triggeredWindows = typeof record.triggeredWindows === 'string'
            ? JSON.parse(record.triggeredWindows)
            : record.triggeredWindows
        } catch {
          // パース失敗時は空配列
        }
      }
      return { date, triggeredWindows }
    })

    return response(200, { activities, days, dayWindows, briefingHistory })
  } catch (error) {
    console.error('アクティビティ取得エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}

/**
 * DynamoDB Items から曜日別パターンを算出
 *
 * /users/activity の handleGetPattern と同一ロジック。
 * 分析対象は直近 ANALYSIS_DAYS 日分のデータに限定。
 */
function computeDayWindows(
  items: Record<string, any>[],
): Record<string, BriefingWindow[]> {
  if (items.length === 0) return {}

  // 直近 ANALYSIS_DAYS 日分にフィルタ
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - ANALYSIS_DAYS)
  const cutoff = cutoffDate.toISOString().slice(0, 10)

  const filteredItems = items.filter((item) => {
    const record = unmarshall(item)
    const date = (record.SK as string).replace('ACTIVITY#', '')
    return date >= cutoff
  })

  if (filteredItems.length === 0) return {}

  // セッション開始時刻を抽出
  const allStarts: SessionStart[] = []
  for (const item of filteredItems) {
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
    filteredItems.map((item) => (unmarshall(item).SK as string).replace('ACTIVITY#', ''))
  )
  const baseWindows = analyzePattern(allStarts, uniqueDays.size)
  if (baseWindows.length === 0) return {}

  // 曜日別にグループ化（confidence 再計算用）
  const startsByDay = new Map<number, SessionStart[]>()
  const datesByDay = new Map<number, Set<string>>()

  for (const item of filteredItems) {
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
  for (let dow = 0; dow < 7; dow++) {
    const dayStarts = startsByDay.get(dow) ?? []
    const dayCount = datesByDay.get(dow)?.size ?? 0
    dayWindows[String(dow)] = recomputeConfidence(baseWindows, dayStarts, dayCount)
  }

  return dayWindows
}
