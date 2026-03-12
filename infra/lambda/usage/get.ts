/**
 * GET /usage — ユーザーの使用量情報を返却
 *
 * フロントエンドが残回数表示・プラン制限 UI に使用する。
 */
import {
  DynamoDBClient,
  BatchGetItemCommand,
  GetItemCommand,
} from '@aws-sdk/client-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const dynamo = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/** プランタイプ */
type PlanType = 'free' | 'paid'

/** プラン別制限定数（rateLimiter.ts と同じ値） */
const PLAN_LIMITS: Record<PlanType, { daily: number; monthly: number; allowedModels: string[] }> = {
  free: { daily: 20, monthly: 500, allowedModels: ['haiku'] },
  paid: { daily: -1, monthly: -1, allowedModels: ['haiku', 'sonnet', 'opus'] },
}

/** JST の現在日付・月を取得 */
function getJSTDateInfo(): { date: string; month: string } {
  const now = new Date()
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const year = jst.getUTCFullYear()
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0')
  const d = String(jst.getUTCDate()).padStart(2, '0')
  return { date: `${year}-${m}-${d}`, month: `${year}-${m}` }
}

/** JST の次の日付 0:00 を ISO 文字列で返す */
function getNextDailyReset(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const jstMidnight = new Date(Date.UTC(y, m - 1, d + 1, -9, 0, 0))
  return jstMidnight.toISOString()
}

/** JST の翌月1日 0:00 を ISO 文字列で返す */
function getNextMonthlyReset(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const nextMonth = m === 12 ? new Date(Date.UTC(y + 1, 0, 1, -9, 0, 0)) : new Date(Date.UTC(y, m, 1, -9, 0, 0))
  return nextMonth.toISOString()
}

function response(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  try {
    const { date, month } = getJSTDateInfo()

    // プラン + 使用量を並列取得
    const [planResult, usageResult] = await Promise.all([
      dynamo.send(new GetItemCommand({
        TableName: TABLE_NAME,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: 'PLAN' } },
      })),
      dynamo.send(new BatchGetItemCommand({
        RequestItems: {
          [TABLE_NAME]: {
            Keys: [
              { PK: { S: `USER#${userId}` }, SK: { S: `USAGE_DAILY#${date}` } },
              { PK: { S: `USER#${userId}` }, SK: { S: `USAGE_MONTHLY#${month}` } },
            ],
          },
        },
      })),
    ])

    const plan: PlanType = planResult.Item?.plan?.S === 'paid' ? 'paid' : 'free'
    const limits = PLAN_LIMITS[plan]
    const items = usageResult.Responses?.[TABLE_NAME] ?? []

    let dailyUsed = 0
    let monthlyUsed = 0
    for (const item of items) {
      const sk = item.SK?.S ?? ''
      const count = parseInt(item.count?.N ?? '0', 10)
      if (sk.startsWith('USAGE_DAILY#')) dailyUsed = count
      else if (sk.startsWith('USAGE_MONTHLY#')) monthlyUsed = count
    }

    return response(200, {
      plan,
      daily: {
        used: dailyUsed,
        limit: limits.daily,
        remaining: limits.daily === -1 ? -1 : Math.max(0, limits.daily - dailyUsed),
      },
      monthly: {
        used: monthlyUsed,
        limit: limits.monthly,
        remaining: limits.monthly === -1 ? -1 : Math.max(0, limits.monthly - monthlyUsed),
      },
      allowedModels: limits.allowedModels,
      resetAt: {
        daily: getNextDailyReset(date),
        monthly: getNextMonthlyReset(month),
      },
    })
  } catch (error) {
    console.error('[Usage] 取得エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}
