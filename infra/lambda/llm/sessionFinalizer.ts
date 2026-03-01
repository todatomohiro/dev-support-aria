import {
  DynamoDBClient,
  QueryCommand,
} from '@aws-sdk/client-dynamodb'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import type { Handler } from 'aws-lambda'

const dynamo = new DynamoDBClient({})
const lambdaClient = new LambdaClient({})
const TABLE_NAME = process.env.TABLE_NAME ?? ''
const EXTRACT_FACTS_FUNCTION_NAME = process.env.EXTRACT_FACTS_FUNCTION_NAME ?? ''

/** セッション終了判定の閾値（30分） */
const SESSION_TIMEOUT_MS = 30 * 60 * 1000

/**
 * セッション終了検出 Lambda — EventBridge 15分ルールで起動
 *
 * ACTIVE_SESSION レコードを走査し、30分以上非アクティブなセッションに対して
 * extractFacts Lambda を非同期起動する。
 */
export const handler: Handler = async () => {
  console.log('[SessionFinalizer] 起動')

  if (!EXTRACT_FACTS_FUNCTION_NAME) {
    console.error('[SessionFinalizer] EXTRACT_FACTS_FUNCTION_NAME が未設定')
    return
  }

  // ACTIVE_SESSION レコードを全件取得
  const result = await dynamo.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: {
      ':pk': { S: 'ACTIVE_SESSION' },
    },
  }))

  const items = result.Items ?? []
  console.log(`[SessionFinalizer] アクティブセッション数: ${items.length}`)

  if (items.length === 0) {
    return
  }

  const now = Date.now()
  let processedCount = 0

  for (const item of items) {
    const updatedAt = item.updatedAt?.S
    if (!updatedAt) continue

    const elapsed = now - new Date(updatedAt).getTime()
    if (elapsed < SESSION_TIMEOUT_MS) continue

    const userId = item.userId?.S
    const sessionId = item.sessionId?.S
    if (!userId || !sessionId) continue

    console.log(`[SessionFinalizer] セッション終了検出: userId=${userId}, sessionId=${sessionId}, elapsed=${Math.round(elapsed / 60000)}分`)

    try {
      await lambdaClient.send(new InvokeCommand({
        FunctionName: EXTRACT_FACTS_FUNCTION_NAME,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ userId, sessionId })),
      }))
      processedCount++
    } catch (error) {
      console.error(`[SessionFinalizer] extractFacts 起動エラー: userId=${userId}`, error)
    }
  }

  console.log(`[SessionFinalizer] 完了: ${processedCount}/${items.length} セッション処理`)
}
