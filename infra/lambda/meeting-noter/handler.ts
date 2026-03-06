import { DynamoDBClient, PutItemCommand, QueryCommand, GetItemCommand } from '@aws-sdk/client-dynamodb'
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime'
import type { APIGatewayProxyResult } from 'aws-lambda'

const db = new DynamoDBClient({})
const bedrock = new BedrockRuntimeClient({})
const TABLE = process.env.TABLE_NAME || 'butler-assistant'
const TTL_DAYS = 30

/**
 * Meeting Noter API（PoC — 認証なし Function URL）
 *
 * POST body:
 *   action: 'start'       — ミーティングセッション作成/再開
 *   action: 'transcript'  — 文字起こしバッチ保存
 *   action: 'ask'         — AI チャット（文字起こしコンテキスト付き）
 *   action: 'get'         — セッション情報取得
 */
export const handler = async (event: { body?: string }): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Content-Type': 'application/json',
  }

  try {
    if (!event.body) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Body required' }) }
    const body = JSON.parse(event.body)
    const { action } = body

    switch (action) {
      case 'start': return { statusCode: 200, headers, body: JSON.stringify(await handleStart(body)) }
      case 'transcript': return { statusCode: 200, headers, body: JSON.stringify(await handleTranscript(body)) }
      case 'ask': return { statusCode: 200, headers, body: JSON.stringify(await handleAsk(body)) }
      case 'get': return { statusCode: 200, headers, body: JSON.stringify(await handleGet(body)) }
      default: return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) }
    }
  } catch (err) {
    console.error('Error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: (err as Error).message }) }
  }
}

/** セッション作成/再開 */
async function handleStart(body: { meetingId: string; meetingUrl?: string; title?: string }) {
  const { meetingId, meetingUrl, title } = body
  if (!meetingId) throw new Error('meetingId is required')

  const now = Date.now()
  const ttl = Math.floor(now / 1000) + TTL_DAYS * 86400
  const defaultTitle = `Meeting ${new Date(now).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`

  // 既存セッションチェック
  const existing = await db.send(new GetItemCommand({
    TableName: TABLE,
    Key: { PK: { S: `MEETING#${meetingId}` }, SK: { S: 'META' } },
  }))

  if (existing.Item) {
    // 既存セッション再開
    return {
      meetingId,
      title: existing.Item.title?.S || defaultTitle,
      startedAt: existing.Item.startedAt?.N,
      resumed: true,
    }
  }

  // 新規作成
  await db.send(new PutItemCommand({
    TableName: TABLE,
    Item: {
      PK: { S: `MEETING#${meetingId}` },
      SK: { S: 'META' },
      meetingId: { S: meetingId },
      meetingUrl: { S: meetingUrl || '' },
      title: { S: title || defaultTitle },
      startedAt: { N: String(now) },
      status: { S: 'active' },
      ttlExpiry: { N: String(ttl) },
    },
  }))

  return { meetingId, title: title || defaultTitle, startedAt: now, resumed: false }
}

/** 文字起こしバッチ保存 */
async function handleTranscript(body: { meetingId: string; entries: Array<{ speaker: string; text: string; timestamp: number; source: string }> }) {
  const { meetingId, entries } = body
  if (!meetingId || !entries?.length) throw new Error('meetingId and entries are required')

  const ttl = Math.floor(Date.now() / 1000) + TTL_DAYS * 86400

  // バッチで保存（25件ずつ）
  for (const entry of entries) {
    await db.send(new PutItemCommand({
      TableName: TABLE,
      Item: {
        PK: { S: `MEETING#${meetingId}` },
        SK: { S: `TR#${entry.timestamp}#${entry.source}` },
        speaker: { S: entry.speaker },
        text: { S: entry.text },
        timestamp: { N: String(entry.timestamp) },
        source: { S: entry.source },
        ttlExpiry: { N: String(ttl) },
      },
    }))
  }

  return { saved: entries.length }
}

/** AI チャット */
async function handleAsk(body: { meetingId: string; question: string }) {
  const { meetingId, question } = body
  if (!meetingId || !question) throw new Error('meetingId and question are required')

  // 文字起こしを取得
  const transcriptText = await getTranscriptText(meetingId)

  if (!transcriptText) {
    return { answer: 'まだ文字起こしがありません。録音を開始してください。' }
  }

  // Bedrock Claude で回答生成
  const systemPrompt = `あなたは会議のアシスタントです。以下の会議の文字起こしを元に、ユーザーの質問に簡潔に回答してください。

<transcript>
${transcriptText}
</transcript>`

  try {
    const response = await bedrock.send(new ConverseCommand({
      modelId: 'anthropic.claude-3-5-haiku-20241022-v1:0',
      system: [{ text: systemPrompt }],
      messages: [{ role: 'user', content: [{ text: question }] }],
      inferenceConfig: { maxTokens: 1024, temperature: 0.3 },
    }))

    const answer = response.output?.message?.content?.[0]?.text || '回答を生成できませんでした'
    return { answer }
  } catch (err) {
    console.error('Bedrock error:', err)
    return { answer: `AI エラー: ${(err as Error).message}` }
  }
}

/** セッション情報取得 */
async function handleGet(body: { meetingId: string }) {
  const { meetingId } = body
  if (!meetingId) throw new Error('meetingId is required')

  const meta = await db.send(new GetItemCommand({
    TableName: TABLE,
    Key: { PK: { S: `MEETING#${meetingId}` }, SK: { S: 'META' } },
  }))

  if (!meta.Item) return { found: false }

  const transcriptText = await getTranscriptText(meetingId)
  const lineCount = transcriptText ? transcriptText.split('\n').length : 0

  return {
    found: true,
    meetingId,
    title: meta.Item.title?.S,
    startedAt: Number(meta.Item.startedAt?.N),
    transcriptLines: lineCount,
  }
}

async function getTranscriptText(meetingId: string): Promise<string> {
  const result = await db.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': { S: `MEETING#${meetingId}` },
      ':sk': { S: 'TR#' },
    },
    ScanIndexForward: true,
  }))

  if (!result.Items?.length) return ''

  return result.Items.map((item) => {
    const time = new Date(Number(item.timestamp?.N)).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo' })
    const speaker = item.speaker?.S || ''
    const src = item.source?.S === 'tab-audio' ? '[参加者]' : '[自分]'
    return `[${time}] ${src} ${speaker}: ${item.text?.S || ''}`
  }).join('\n')
}
