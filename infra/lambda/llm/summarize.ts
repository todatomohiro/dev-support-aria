import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime'
import { BACKGROUND_MODEL_ID } from './models'
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

const SEGMENT_SUMMARY_PROMPT = `あなたは会話要約の専門家です。以下の会話区間の要約を作成してください。
ルール：
- この会話区間だけの要点をまとめる（前後の文脈は考慮しない）
- 以下のJSON形式で出力：{"keywords": ["キーワード1", "キーワード2"], "summary": "要約テキスト"}
- keywords: 会話の主要トピックを表すキーワードを2〜3個（各2〜4語）
- summary: 300文字以内で簡潔に
- JSONのみを出力し、他の説明は不要`

interface SummarizeEvent {
  userId: string
  sessionId: string
  /** テーマセッションの場合に設定される */
  themeId?: string
}

/**
 * 会話要約 Lambda — Haiku 4.5 で会話の要約を生成し、DynamoDB に保存
 *
 * chat Lambda から InvocationType: 'Event' で非同期起動される。
 * themeId が指定されている場合はテーマセッションの名前空間を使用する。
 */
export const handler: Handler<SummarizeEvent, void> = async (event) => {
  const { userId, sessionId, themeId } = event
  const sessionType = themeId ? `themeId=${themeId}` : `sessionId=${sessionId}`
  console.log(`[Summarize] userId=${userId}, ${sessionType}`)

  // セッション種別に応じた PK/SK を決定
  const sessionSK = themeId
    ? `THEME_SESSION#${themeId}`
    : `SESSION#${sessionId}`
  const messagePK = themeId
    ? `USER#${userId}#THEME#${themeId}`
    : `USER#${userId}#SESSION#${sessionId}`

  // 既存セッションレコード（前回の要約）を取得
  const sessionResult = await dynamo.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: { S: `USER#${userId}` },
      SK: { S: sessionSK },
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
        ':pk': { S: messagePK },
        ':skStart': { S: `MSG#${lastSummarizedAt}` },
        ':skEnd': { S: 'MSG#~' },
      }
      : {
        ':pk': { S: messagePK },
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

  // Haiku 4.5 でローリング要約とセグメント要約を並列生成
  const [rollingResult, segmentResult] = await Promise.all([
    bedrock.send(new ConverseCommand({
      modelId: BACKGROUND_MODEL_ID,
      messages: [{ role: 'user', content: [{ text: userPrompt }] }],
      system: [{ text: SUMMARY_PROMPT }],
      inferenceConfig: { maxTokens: 1024, temperature: 0.3 },
    })),
    bedrock.send(new ConverseCommand({
      modelId: BACKGROUND_MODEL_ID,
      messages: [{ role: 'user', content: [{ text: `会話：\n${conversationText}` }] }],
      system: [{ text: SEGMENT_SUMMARY_PROMPT }],
      inferenceConfig: { maxTokens: 512, temperature: 0.3 },
    })),
  ])

  const summaryText = (rollingResult.output?.message?.content ?? [])
    .filter((block): block is { text: string } => 'text' in block && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')

  if (!summaryText) {
    console.warn('[Summarize] 要約生成結果が空')
    return
  }

  console.log(`[Summarize] 要約生成完了 (${summaryText.length} chars)`)

  // セグメント要約をパース（JSON 失敗時はテキストそのままフォールバック）
  const segmentText = (segmentResult.output?.message?.content ?? [])
    .filter((block): block is { text: string } => 'text' in block && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')

  let segmentKeywords: string[] = []
  let segmentSummary = ''
  if (segmentText) {
    try {
      const parsed = JSON.parse(segmentText)
      segmentKeywords = Array.isArray(parsed.keywords) ? parsed.keywords : []
      segmentSummary = typeof parsed.summary === 'string' ? parsed.summary : segmentText
    } catch {
      segmentSummary = segmentText
    }
    console.log(`[Summarize] セグメント要約生成完了 (keywords=${segmentKeywords.join(', ')})`)
  }

  // セッションレコードに要約を書き戻す
  const now = new Date().toISOString()
  const ttlExpiry = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 // 7日後

  await dynamo.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: { S: `USER#${userId}` },
      SK: { S: sessionSK },
      summary: { S: summaryText },
      turnsSinceSummary: { N: '0' },
      lastSummarizedAt: { S: now },
      updatedAt: { S: now },
      ...(sessionResult.Item?.createdAt ? { createdAt: sessionResult.Item.createdAt } : { createdAt: { S: now } }),
      ...(sessionResult.Item?.totalTurns ? { totalTurns: sessionResult.Item.totalTurns } : {}),
      // テーマセッションの場合は themeName と themeId を保持
      ...(sessionResult.Item?.themeName ? { themeName: sessionResult.Item.themeName } : {}),
      ...(sessionResult.Item?.themeId ? { themeId: sessionResult.Item.themeId } : {}),
      ttlExpiry: { N: String(ttlExpiry) },
    },
  }))

  // セグメント要約をチェックポイントとして保存
  if (segmentSummary) {
    await dynamo.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: { S: messagePK },
        SK: { S: `SUMMARY_CP#${now}` },
        summary: { S: segmentSummary },
        keywords: { L: segmentKeywords.map((k) => ({ S: k })) },
        createdAt: { S: now },
        ttlExpiry: { N: String(ttlExpiry) },
      },
    }))
    console.log('[Summarize] チェックポイント保存完了')
  }

  console.log('[Summarize] セッションレコード更新完了')
}
