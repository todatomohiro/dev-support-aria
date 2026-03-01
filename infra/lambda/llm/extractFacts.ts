import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime'
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  DeleteItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb'
import type { Handler } from 'aws-lambda'

const bedrock = new BedrockRuntimeClient({})
const dynamo = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME ?? ''

/** 永久記憶の最大件数 */
const MAX_FACTS = 50

const FACT_EXTRACTION_PROMPT = `あなたはユーザープロフィール抽出の専門家です。
以下の会話から、ユーザーについて永久に記憶すべき重要な「事実」を抽出してください。

抽出する事実:
- 変わりにくい属性（趣味、職業、家族構成、生活習慣、好み、特技など）
- 重要な出来事や経験
- 明確に述べられた好み・嫌い

ルール:
- 1行1事実、最大50文字
- 明言された事実のみ（推測は含めない）
- 既に記録済みの事実と重複する内容は出力しない
- 最大10個まで
- 該当する事実がなければ「なし」とだけ出力
- 事実のみを出力（説明や番号は不要）`

interface ExtractFactsEvent {
  userId: string
  sessionId: string
}

/**
 * 事実抽出 Lambda — セッション終了時に会話から永久事実を抽出して保存
 *
 * sessionFinalizer Lambda から InvocationType: 'Event' で非同期起動される。
 */
export const handler: Handler<ExtractFactsEvent, void> = async (event) => {
  const { userId, sessionId } = event
  console.log(`[ExtractFacts] userId=${userId}, sessionId=${sessionId}`)

  // 1. セッションの全メッセージを取得
  const messagesResult = await dynamo.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': { S: `USER#${userId}#SESSION#${sessionId}` },
      ':skPrefix': { S: 'MSG#' },
    },
    ScanIndexForward: true,
  }))

  const messages = (messagesResult.Items ?? []).map((item) => ({
    role: item.role?.S ?? 'user',
    content: item.content?.S ?? '',
  }))

  if (messages.length === 0) {
    console.log('[ExtractFacts] メッセージなし — スキップ')
    await deleteActiveSession(userId, sessionId)
    return
  }

  // 2. 既存の永久記憶を取得
  const existingResult = await dynamo.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: { S: `USER#${userId}` },
      SK: { S: 'PERMANENT_FACTS' },
    },
  }))

  const existingFacts = (existingResult.Item?.facts?.L ?? [])
    .map((item) => item.S ?? '')
    .filter(Boolean)

  // 3. 会話テキストを構築
  const conversationText = messages
    .map((m) => `${m.role === 'user' ? 'ユーザー' : 'アシスタント'}: ${m.content}`)
    .join('\n')

  let userPrompt: string
  if (existingFacts.length > 0) {
    const existingText = existingFacts.map((f) => `- ${f}`).join('\n')
    userPrompt = `既に記録済みの事実：\n${existingText}\n\n会話：\n${conversationText}`
  } else {
    userPrompt = `会話：\n${conversationText}`
  }

  // 4. Haiku 4.5 で事実抽出
  const result = await bedrock.send(new ConverseCommand({
    modelId: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0',
    messages: [{ role: 'user', content: [{ text: userPrompt }] }],
    system: [{ text: FACT_EXTRACTION_PROMPT }],
    inferenceConfig: {
      maxTokens: 1024,
      temperature: 0.3,
    },
  }))

  const responseText = (result.output?.message?.content ?? [])
    .filter((block): block is { text: string } => 'text' in block && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')

  if (!responseText || responseText.trim() === 'なし') {
    console.log('[ExtractFacts] 新規事実なし')
    await deleteActiveSession(userId, sessionId)
    return
  }

  // 5. 新規事実をパース（1行1事実、空行・余計な記号を除去）
  const newFacts = responseText
    .split('\n')
    .map((line) => line.replace(/^[-・•]\s*/, '').trim())
    .filter((line) => line.length > 0 && line.length <= 50)

  if (newFacts.length === 0) {
    console.log('[ExtractFacts] パース後の新規事実なし')
    await deleteActiveSession(userId, sessionId)
    return
  }

  console.log(`[ExtractFacts] 新規事実 ${newFacts.length} 件: ${newFacts.join(' / ')}`)

  // 6. 既存事実とマージ（上限50個、古いものから押し出し）
  const mergedFacts = [...existingFacts, ...newFacts].slice(-MAX_FACTS)

  // 7. PERMANENT_FACTS レコードを更新
  const now = new Date().toISOString()
  await dynamo.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: { S: `USER#${userId}` },
      SK: { S: 'PERMANENT_FACTS' },
    },
    UpdateExpression: 'SET facts = :facts, lastUpdatedAt = :now',
    ExpressionAttributeValues: {
      ':facts': { L: mergedFacts.map((f) => ({ S: f })) },
      ':now': { S: now },
    },
  }))

  console.log(`[ExtractFacts] 永久記憶更新完了 (計 ${mergedFacts.length} 件)`)

  // 8. ACTIVE_SESSION レコードを削除
  await deleteActiveSession(userId, sessionId)
}

/**
 * ACTIVE_SESSION レコードを削除
 */
async function deleteActiveSession(userId: string, sessionId: string): Promise<void> {
  try {
    await dynamo.send(new DeleteItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: 'ACTIVE_SESSION' },
        SK: { S: `${userId}#${sessionId}` },
      },
    }))
    console.log(`[ExtractFacts] ACTIVE_SESSION 削除完了: ${userId}#${sessionId}`)
  } catch (error) {
    console.warn('[ExtractFacts] ACTIVE_SESSION 削除エラー:', error)
  }
}
