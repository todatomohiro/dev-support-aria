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

抽出対象（以下の48カテゴリに該当するもののみ）:
【基本属性】生年月日/年齢、血液型、国籍、出身地
【居住】居住地、住居形態（持ち家/賃貸/実家）、最寄り駅、同居人の有無と構成
【家族】婚姻状況、配偶者/パートナーの名前、子供の人数/名前/年齢、両親の名前/健在か、兄弟姉妹の構成、ペットの種類/名前、家族の記念日
【仕事】勤務先、職種/役職、業界、勤務形態（出社/リモート）、通勤手段/通勤時間、副業
【学歴・資格】最終学歴/専攻、保有資格/免許、学習中のスキル
【健康】食物アレルギー、その他アレルギー（花粉/動物等）、持病/既往歴、服用中の薬、食事制限、視力（メガネ/コンタクト）、身体的制約
【生活】生活リズム（朝型/夜型）、喫煙/飲酒、運動習慣、所有車両、よく使う交通手段、宗教/信仰
【嗜好・価値観】好き嫌いな食べ物、好きな音楽/アーティスト、長年の趣味、苦手なもの/恐怖症、大切な価値観
【経済】家計管理の方針、大きな経済目標
【その他】母語/話せる言語、よく行く場所/行きつけの店、重要な人生イベントの予定、利き手

抽出しない:
- 一時的な興味や関心（「最近○○にハマっている」）
- その場限りの希望（「今日はカレーが食べたい」）
- 会話の相談内容や質問そのもの
- 上記48カテゴリに該当しない情報

ルール:
- 1行1事実、最大50文字
- ユーザーが明言した事実のみ（推測は含めない）
- 既に記録済みの事実と重複する内容は出力しない
- 最大10個まで
- 該当する事実がなければ「なし」とだけ出力
- 事実のみを出力（説明や番号は不要）`

interface ExtractFactsEvent {
  userId: string
  sessionId: string
  /** テーマセッションの場合に設定される */
  themeId?: string
}

/**
 * 事実抽出 Lambda — セッション終了時に会話から永久事実を抽出して保存
 *
 * sessionFinalizer Lambda から InvocationType: 'Event' で非同期起動される。
 * themeId が指定されている場合はテーマセッションの名前空間からメッセージを取得する。
 */
export const handler: Handler<ExtractFactsEvent, void> = async (event) => {
  const { userId, sessionId, themeId } = event
  const sessionType = themeId ? `themeId=${themeId}` : `sessionId=${sessionId}`
  console.log(`[ExtractFacts] userId=${userId}, ${sessionType}`)

  // メッセージの PK をセッション種別に応じて決定
  const messagePK = themeId
    ? `USER#${userId}#THEME#${themeId}`
    : `USER#${userId}#SESSION#${sessionId}`

  // 1. セッションの全メッセージを取得
  const messagesResult = await dynamo.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': { S: messagePK },
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
    await deleteActiveSession(userId, sessionId, themeId)
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
    await deleteActiveSession(userId, sessionId, themeId)
    return
  }

  // 5. 新規事実をパース（1行1事実、空行・余計な記号を除去）
  const newFacts = responseText
    .split('\n')
    .map((line) => line.replace(/^[-・•]\s*/, '').trim())
    .filter((line) => line.length > 0 && line.length <= 50)

  if (newFacts.length === 0) {
    console.log('[ExtractFacts] パース後の新規事実なし')
    await deleteActiveSession(userId, sessionId, themeId)
    return
  }

  console.log(`[ExtractFacts] 新規事実 ${newFacts.length} 件: ${newFacts.join(' / ')}`)

  // 6. 既存事実とマージ（上限50個、古いものから押し出し）
  const mergedFacts = [...existingFacts, ...newFacts].slice(-MAX_FACTS)

  // 7. PERMANENT_FACTS レコードを更新（メインと共有）
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
  await deleteActiveSession(userId, sessionId, themeId)
}

/**
 * ACTIVE_SESSION レコードを削除
 */
async function deleteActiveSession(userId: string, sessionId: string, themeId?: string): Promise<void> {
  const sk = themeId ? `${userId}#theme:${themeId}` : `${userId}#${sessionId}`
  try {
    await dynamo.send(new DeleteItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: 'ACTIVE_SESSION' },
        SK: { S: sk },
      },
    }))
    console.log(`[ExtractFacts] ACTIVE_SESSION 削除完了: ${sk}`)
  } catch (error) {
    console.warn('[ExtractFacts] ACTIVE_SESSION 削除エラー:', error)
  }
}
