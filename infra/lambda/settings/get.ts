import { DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand, BatchGetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/** プラン別制限定数 */
const PLAN_LIMITS: Record<string, { daily: number; monthly: number; premiumMonthly: number; allowedModels: string[] }> = {
  free: { daily: 15, monthly: 300, premiumMonthly: 0, allowedModels: ['haiku'] },
  paid: { daily: 40, monthly: 1000, premiumMonthly: 60, allowedModels: ['haiku', 'sonnet', 'opus'] },
  platinum: { daily: -1, monthly: -1, premiumMonthly: 200, allowedModels: ['haiku', 'sonnet', 'opus'] },
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

/**
 * GET /settings — ユーザー設定を取得
 * PUT /settings — ユーザー設定を保存
 * GET /usage — 使用量情報を取得
 * PUT /plan — プラン変更（開発用セルフサービス）
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  // パスで分岐
  const resource = event.resource ?? event.path ?? ''
  if (resource === '/settings/onboarding' && event.httpMethod === 'POST') {
    return handleOnboarding(userId, event.body)
  }
  if (resource === '/usage') {
    if (event.httpMethod === 'PUT') {
      return handlePlanChange(userId, event.body)
    }
    return handleUsage(userId)
  }
  if (event.httpMethod === 'PUT') {
    return handleSettingsPut(userId, event.body)
  }
  return handleSettings(userId)
}

/** GET /settings ハンドラー */
async function handleSettings(userId: string): Promise<APIGatewayProxyResult> {
  try {
    const result = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: 'SETTINGS' },
      },
    }))

    if (!result.Item) {
      return response(200, { settings: null })
    }

    const item = unmarshall(result.Item)
    return response(200, { settings: item.data })
  } catch (error) {
    console.error('設定取得エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}

/** POST /settings/onboarding ハンドラー — プロフィール保存 + 永久記憶に初期情報を登録 */
async function handleOnboarding(userId: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) {
    return response(400, { error: 'Request body is required' })
  }
  try {
    const data = JSON.parse(body) as {
      nickname?: string
      gender?: string
      aiName?: string
      tone?: string
      occupation?: string
      interests?: string[]
      lifestyle?: string
    }

    // 1. 既存設定を取得してマージ
    const existingResult = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: { PK: { S: `USER#${userId}` }, SK: { S: 'SETTINGS' } },
    }))
    const existing = existingResult.Item ? unmarshall(existingResult.Item).data ?? {} : {}

    // プロフィールをマージ
    const profile = {
      ...(existing.profile ?? {}),
      nickname: data.nickname ?? '',
      gender: data.gender === 'none' ? '' : (data.gender ?? ''),
      aiName: data.aiName ?? '',
    }

    const settings = {
      ...existing,
      profile,
      onboardingCompleted: true,
    }

    // SETTINGS 保存
    await client.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        PK: `USER#${userId}`,
        SK: 'SETTINGS',
        data: settings,
        updatedAt: Date.now(),
      }, { removeUndefinedValues: true }),
    }))

    // 2. 永久記憶に初期情報を追加（facts + preferences）
    const newFacts: string[] = []
    const newPreferences: string[] = []

    if (data.occupation) {
      newFacts.push(`職業・立場: ${data.occupation}`)
    }
    if (data.interests && data.interests.length > 0) {
      for (const interest of data.interests) {
        newFacts.push(`${interest}に興味がある`)
      }
    }
    if (data.lifestyle) {
      newFacts.push(`ライフスタイル: ${data.lifestyle}`)
    }
    if (data.tone) {
      const toneMap: Record<string, string> = {
        friendly: 'フレンドリーなタメ口で話してほしい',
        polite: '敬語で丁寧に話してほしい',
        casual: 'カジュアルで親しみやすい口調で話してほしい',
      }
      if (toneMap[data.tone]) {
        newPreferences.push(toneMap[data.tone]!)
      }
    }

    // 永久記憶が存在する場合はマージ、存在しない場合は新規作成
    if (newFacts.length > 0 || newPreferences.length > 0) {
      const factsResult = await client.send(new GetItemCommand({
        TableName: TABLE_NAME,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: 'PERMANENT_FACTS' } },
      }))

      let existingFacts: string[] = []
      let existingPreferences: string[] = []
      if (factsResult.Item) {
        const factsData = unmarshall(factsResult.Item)
        existingFacts = factsData.facts ?? []
        existingPreferences = factsData.preferences ?? []
      }

      // 重複を避けてマージ
      const mergedFacts = [...existingFacts]
      for (const f of newFacts) {
        if (!mergedFacts.some(ef => ef.includes(f) || f.includes(ef))) {
          mergedFacts.push(f)
        }
      }
      const mergedPreferences = [...existingPreferences]
      for (const p of newPreferences) {
        if (!mergedPreferences.some(ep => ep.includes(p) || p.includes(ep))) {
          mergedPreferences.push(p)
        }
      }

      await client.send(new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall({
          PK: `USER#${userId}`,
          SK: 'PERMANENT_FACTS',
          facts: mergedFacts,
          preferences: mergedPreferences,
          lastUpdatedAt: new Date().toISOString(),
        }, { removeUndefinedValues: true }),
      }))
    }

    return response(200, { success: true })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    console.error('オンボーディング保存エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}

/** PUT /settings ハンドラー */
async function handleSettingsPut(userId: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) {
    return response(400, { error: 'Request body is required' })
  }
  try {
    const settings = JSON.parse(body)
    await client.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        PK: `USER#${userId}`,
        SK: 'SETTINGS',
        data: settings,
        updatedAt: Date.now(),
      }, { removeUndefinedValues: true }),
    }))
    return response(200, { success: true })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    console.error('設定保存エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}

/** PUT /plan ハンドラー（開発用セルフサービス） */
async function handlePlanChange(userId: string, body: string | null): Promise<APIGatewayProxyResult> {
  try {
    const parsed = JSON.parse(body ?? '{}')
    const { plan } = parsed

    if (plan !== 'free' && plan !== 'paid' && plan !== 'platinum') {
      return response(400, { error: 'plan must be "free", "paid", or "platinum"' })
    }

    const now = new Date().toISOString()

    if (plan === 'free') {
      await client.send(new DeleteItemCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: { S: `USER#${userId}` },
          SK: { S: 'PLAN' },
        },
      }))
    } else {
      await client.send(new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall({
          PK: `USER#${userId}`,
          SK: 'PLAN',
          plan,
          updatedAt: now,
          updatedBy: userId,
        }),
      }))
    }

    return response(200, { userId, plan })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    console.error('プラン更新エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}

/** GET /usage ハンドラー */
async function handleUsage(userId: string): Promise<APIGatewayProxyResult> {
  try {
    const { date, month } = getJSTDateInfo()

    const [planResult, usageResult] = await Promise.all([
      client.send(new GetItemCommand({
        TableName: TABLE_NAME,
        Key: { PK: { S: `USER#${userId}` }, SK: { S: 'PLAN' } },
      })),
      client.send(new BatchGetItemCommand({
        RequestItems: {
          [TABLE_NAME]: {
            Keys: [
              { PK: { S: `USER#${userId}` }, SK: { S: `USAGE_DAILY#${date}` } },
              { PK: { S: `USER#${userId}` }, SK: { S: `USAGE_MONTHLY#${month}` } },
              { PK: { S: `USER#${userId}` }, SK: { S: `USAGE_PREMIUM_MONTHLY#${month}` } },
            ],
          },
        },
      })),
    ])

    const planValue = planResult.Item?.plan?.S
    const plan = planValue === 'platinum' ? 'platinum' : planValue === 'paid' ? 'paid' : 'free'
    const limits = PLAN_LIMITS[plan]
    const items = usageResult.Responses?.[TABLE_NAME] ?? []

    let dailyUsed = 0
    let monthlyUsed = 0
    let premiumMonthlyUsed = 0
    for (const item of items) {
      const sk = item.SK?.S ?? ''
      const count = parseInt(item.count?.N ?? '0', 10)
      if (sk.startsWith('USAGE_DAILY#')) dailyUsed = count
      else if (sk.startsWith('USAGE_PREMIUM_MONTHLY#')) premiumMonthlyUsed = count
      else if (sk.startsWith('USAGE_MONTHLY#')) monthlyUsed = count
    }

    // 次のリセット時刻計算
    const [y, mo, d] = date.split('-').map(Number)
    const nextDaily = new Date(Date.UTC(y, mo - 1, d + 1, -9, 0, 0)).toISOString()
    const [y2, m2] = month.split('-').map(Number)
    const nextMonthly = (m2 === 12 ? new Date(Date.UTC(y2 + 1, 0, 1, -9, 0, 0)) : new Date(Date.UTC(y2, m2, 1, -9, 0, 0))).toISOString()

    return response(200, {
      plan,
      daily: {
        used: dailyUsed,
        limit: limits.daily,
        remaining: Math.max(0, limits.daily - dailyUsed),
      },
      monthly: {
        used: monthlyUsed,
        limit: limits.monthly,
        remaining: Math.max(0, limits.monthly - monthlyUsed),
      },
      premiumMonthly: {
        used: premiumMonthlyUsed,
        limit: limits.premiumMonthly,
        remaining: Math.max(0, limits.premiumMonthly - premiumMonthlyUsed),
      },
      allowedModels: limits.allowedModels,
      resetAt: { daily: nextDaily, monthly: nextMonthly },
    })
  } catch (error) {
    console.error('[Usage] 取得エラー:', error)
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
