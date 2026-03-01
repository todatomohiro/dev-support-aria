import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime'
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb'
import type { Handler } from 'aws-lambda'

const bedrock = new BedrockRuntimeClient({})
const dynamo = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME ?? ''

const SUMMARY_PROMPT = `あなたは会話要約の専門家です。以下の会話の要約を日本語で作成してください。
ルール：
- 話題、決定事項、ユーザーの好み・要望を中心にまとめる
- 500文字以内で簡潔に
- 前回の要約がある場合は、それを更新する形で統合する
- プレーンテキストのみ（マークダウン不可）
- 要約のみを出力し、他の説明は不要`

interface SummarizeEvent {
  userId: string
  sessionId: string
}

/**
 * 会話要約 Lambda — Haiku 4.5 で会話の要約を生成し、DynamoDB に保存
 *
 * chat Lambda から InvocationType: 'Event' で非同期起動される。
 */
export const handler: Handler<SummarizeEvent, void> = async (event) => {
  const { userId, sessionId } = event
  console.log(`[Summarize] userId=${userId}, sessionId=${sessionId}`)

  // 既存セッションレコード（前回の要約）を取得
  const sessionResult = await dynamo.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: { S: `USER#${userId}` },
      SK: { S: `SESSION#${sessionId}` },
    },
  }))

  const previousSummary = sessionResult.Item?.summary?.S ?? ''
  const lastSummarizedAt = sessionResult.Item?.lastSummarizedAt?.S

  // 前回要約以降のメッセージを取得（MSG# の SK は ISO タイムスタンプ付き）
  const queryParams: Record<string, unknown> = {
    TableName: TABLE_NAME,
    KeyConditionExpression: lastSummarizedAt
      ? 'PK = :pk AND SK BETWEEN :skStart AND :skEnd'
      : 'PK = :pk AND begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: lastSummarizedAt
      ? {
        ':pk': { S: `USER#${userId}#SESSION#${sessionId}` },
        ':skStart': { S: `MSG#${lastSummarizedAt}` },
        ':skEnd': { S: 'MSG#~' },
      }
      : {
        ':pk': { S: `USER#${userId}#SESSION#${sessionId}` },
        ':skPrefix': { S: 'MSG#' },
      },
    ScanIndexForward: true,
  }

  const messagesResult = await dynamo.send(new QueryCommand(queryParams as Parameters<typeof dynamo.send>[0] extends { input: infer T } ? T : never))
  const messages = (messagesResult.Items ?? []).map((item) => ({
    role: item.role?.S ?? 'user',
    content: item.content?.S ?? '',
  }))

  if (messages.length === 0) {
    console.log('[Summarize] 新しいメッセージなし — スキップ')
    return
  }

  // 要約対象テキストを構築
  const conversationText = messages
    .map((m) => `${m.role === 'user' ? 'ユーザー' : 'アシスタント'}: ${m.content}`)
    .join('\n')

  let userPrompt: string
  if (previousSummary) {
    userPrompt = `前回の要約：\n${previousSummary}\n\n新しい会話：\n${conversationText}`
  } else {
    userPrompt = `会話：\n${conversationText}`
  }

  // Haiku 4.5 で要約生成
  const result = await bedrock.send(new ConverseCommand({
    modelId: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0',
    messages: [{ role: 'user', content: [{ text: userPrompt }] }],
    system: [{ text: SUMMARY_PROMPT }],
    inferenceConfig: {
      maxTokens: 1024,
      temperature: 0.3,
    },
  }))

  const summaryText = (result.output?.message?.content ?? [])
    .filter((block): block is { text: string } => 'text' in block && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')

  if (!summaryText) {
    console.warn('[Summarize] 要約生成結果が空')
    return
  }

  console.log(`[Summarize] 要約生成完了 (${summaryText.length} chars)`)

  // セッションレコードに要約を書き戻す
  const now = new Date().toISOString()
  const ttlExpiry = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 // 7日後

  await dynamo.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: { S: `USER#${userId}` },
      SK: { S: `SESSION#${sessionId}` },
      summary: { S: summaryText },
      turnsSinceSummary: { N: '0' },
      lastSummarizedAt: { S: now },
      updatedAt: { S: now },
      ...(sessionResult.Item?.createdAt ? { createdAt: sessionResult.Item.createdAt } : { createdAt: { S: now } }),
      ...(sessionResult.Item?.totalTurns ? { totalTurns: sessionResult.Item.totalTurns } : {}),
      ttlExpiry: { N: String(ttlExpiry) },
    },
  }))

  console.log('[Summarize] セッションレコード更新完了')
}
