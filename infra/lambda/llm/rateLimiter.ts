/**
 * レートリミッター
 *
 * 無料/有料プランに基づくメッセージ使用量の制御を行う。
 * DynamoDB カウンター方式で日次・月次の使用量を管理。
 */
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
  BatchGetItemCommand,
} from '@aws-sdk/client-dynamodb'

const dynamo = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME ?? ''

/** プランタイプ */
export type PlanType = 'free' | 'paid' | 'platinum'

/** プレミアムモード対象モデル */
const PREMIUM_MODELS = ['sonnet', 'opus']

/** プラン別制限定数 */
export const PLAN_LIMITS: Record<PlanType, {
  daily: number
  monthly: number
  premiumMonthly: number
  allowedModels: string[]
}> = {
  free: {
    daily: 15,
    monthly: 300,
    premiumMonthly: 0,
    allowedModels: ['haiku'],
  },
  paid: {
    daily: 40,
    monthly: 1000,
    premiumMonthly: 60,
    allowedModels: ['haiku', 'sonnet', 'opus'],
  },
  platinum: {
    daily: Infinity,
    monthly: Infinity,
    premiumMonthly: 200,
    allowedModels: ['haiku', 'sonnet', 'opus'],
  },
}

/** レートリミットチェック結果 */
export interface RateLimitResult {
  allowed: boolean
  reason?: 'daily_limit' | 'monthly_limit' | 'premium_monthly_limit' | 'model_not_allowed'
  plan: PlanType
  daily: { used: number; limit: number; remaining: number }
  monthly: { used: number; limit: number; remaining: number }
  premiumMonthly: { used: number; limit: number; remaining: number }
  allowedModels: string[]
}

/**
 * JST の現在日付・月を取得
 */
function getJSTDateInfo(): { date: string; month: string } {
  const now = new Date()
  // UTC+9 で JST に変換
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const year = jst.getUTCFullYear()
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0')
  const d = String(jst.getUTCDate()).padStart(2, '0')
  return {
    date: `${year}-${m}-${d}`,
    month: `${year}-${m}`,
  }
}

/**
 * ユーザーのプランを取得（レコードなし = free）
 */
export async function getUserPlan(userId: string): Promise<PlanType> {
  const result = await dynamo.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: { S: `USER#${userId}` },
      SK: { S: 'PLAN' },
    },
  }))
  const planValue = result.Item?.plan?.S
  if (planValue === 'platinum') return 'platinum'
  if (planValue === 'paid') return 'paid'
  return 'free'
}

/**
 * レートリミットチェック
 *
 * プラン取得 + 使用量取得 + 判定を行い、メッセージ送信可否を返却。
 */
export async function checkRateLimit(userId: string, modelKey: string): Promise<RateLimitResult> {
  const { date, month } = getJSTDateInfo()

  const isPremiumModel = PREMIUM_MODELS.includes(modelKey)

  // プラン + 使用量を並列取得
  const [plan, usageResult] = await Promise.all([
    getUserPlan(userId),
    dynamo.send(new BatchGetItemCommand({
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

  const limits = PLAN_LIMITS[plan]
  const items = usageResult.Responses?.[TABLE_NAME] ?? []

  let dailyUsed = 0
  let monthlyUsed = 0
  let premiumMonthlyUsed = 0
  for (const item of items) {
    const sk = item.SK?.S ?? ''
    const count = parseInt(item.count?.N ?? '0', 10)
    if (sk.startsWith('USAGE_DAILY#')) {
      dailyUsed = count
    } else if (sk.startsWith('USAGE_PREMIUM_MONTHLY#')) {
      premiumMonthlyUsed = count
    } else if (sk.startsWith('USAGE_MONTHLY#')) {
      monthlyUsed = count
    }
  }

  const result: RateLimitResult = {
    allowed: true,
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
  }

  // モデル制限チェック
  if (!limits.allowedModels.includes(modelKey)) {
    result.allowed = false
    result.reason = 'model_not_allowed'
    return result
  }

  // 日次制限チェック（Normal モードの日次上限）
  if (dailyUsed >= limits.daily) {
    result.allowed = false
    result.reason = 'daily_limit'
    return result
  }

  // 月次制限チェック（Normal モードの月次上限）
  if (monthlyUsed >= limits.monthly) {
    result.allowed = false
    result.reason = 'monthly_limit'
    return result
  }

  // Premium モード月次制限チェック
  if (isPremiumModel && limits.premiumMonthly > 0 && premiumMonthlyUsed >= limits.premiumMonthly) {
    result.allowed = false
    result.reason = 'premium_monthly_limit'
    return result
  }

  return result
}

/**
 * 使用量をインクリメント（日次・月次を同時に atomic increment）
 *
 * Premium モデル（sonnet/opus）使用時は追加で USAGE_PREMIUM_MONTHLY# もインクリメント。
 */
export async function incrementUsage(userId: string, modelKey?: string): Promise<void> {
  const { date, month } = getJSTDateInfo()

  // 日次 TTL: 2日後、月次 TTL: 35日後
  const now = Math.floor(Date.now() / 1000)
  const dailyTTL = now + 2 * 24 * 60 * 60
  const monthlyTTL = now + 35 * 24 * 60 * 60

  const updates: Promise<unknown>[] = [
    dynamo.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: `USAGE_DAILY#${date}` },
      },
      UpdateExpression: 'ADD #count :inc SET #ttl = if_not_exists(#ttl, :ttl)',
      ExpressionAttributeNames: {
        '#count': 'count',
        '#ttl': 'ttlExpiry',
      },
      ExpressionAttributeValues: {
        ':inc': { N: '1' },
        ':ttl': { N: String(dailyTTL) },
      },
    })),
    dynamo.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: `USAGE_MONTHLY#${month}` },
      },
      UpdateExpression: 'ADD #count :inc SET #ttl = if_not_exists(#ttl, :ttl)',
      ExpressionAttributeNames: {
        '#count': 'count',
        '#ttl': 'ttlExpiry',
      },
      ExpressionAttributeValues: {
        ':inc': { N: '1' },
        ':ttl': { N: String(monthlyTTL) },
      },
    })),
  ]

  // Premium モデル使用時は Premium 月次カウンターもインクリメント
  if (modelKey && PREMIUM_MODELS.includes(modelKey)) {
    updates.push(
      dynamo.send(new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: { S: `USER#${userId}` },
          SK: { S: `USAGE_PREMIUM_MONTHLY#${month}` },
        },
        UpdateExpression: 'ADD #count :inc SET #ttl = if_not_exists(#ttl, :ttl)',
        ExpressionAttributeNames: {
          '#count': 'count',
          '#ttl': 'ttlExpiry',
        },
        ExpressionAttributeValues: {
          ':inc': { N: '1' },
          ':ttl': { N: String(monthlyTTL) },
        },
      })),
    )
  }

  await Promise.all(updates)
}

/**
 * レートリミット到達時のソフトリミットメッセージを生成
 */
export function buildRateLimitMessage(reason: RateLimitResult['reason']): string {
  switch (reason) {
    case 'daily_limit':
      return JSON.stringify({
        text: '今日のお話回数の上限に達しちゃった…🥺 明日になったらまた話せるから、待っててね！\n\nもっとたくさんお話ししたい場合は、プレミアムプランへのアップグレードもご検討ください ✨',
        emotion: 'troubled',
      })
    case 'monthly_limit':
      return JSON.stringify({
        text: '今月のお話回数の上限に達しちゃった…🥺 来月になったらまたたくさんお話できるよ！\n\nプレミアムプランならもっとたくさんお話しできます ✨',
        emotion: 'troubled',
      })
    case 'premium_monthly_limit':
      return JSON.stringify({
        text: '今月の Premium モードの利用回数の上限に達しちゃった…🥺 Normal モードならまだ使えるよ！来月になったらまた Premium モードも使えるようになるからね ✨',
        emotion: 'troubled',
      })
    case 'model_not_allowed':
      return JSON.stringify({
        text: 'Premium モードは有料プランで使えるよ！ Normal モードなら今すぐ使えるから試してみてね 😊',
        emotion: 'happy',
      })
    default:
      return JSON.stringify({
        text: '現在ご利用いただけません。しばらくしてからお試しください。',
        emotion: 'troubled',
      })
  }
}
