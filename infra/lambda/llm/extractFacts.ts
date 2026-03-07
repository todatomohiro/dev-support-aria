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

/** カテゴリ別の最大件数 */
const MAX_FACTS = 40
const MAX_PREFERENCES = 15
/** 統合を実行する閾値（カテゴリ別、この件数以上で自動統合） */
const FACTS_CONSOLIDATION_THRESHOLD = 30
const PREFERENCES_CONSOLIDATION_THRESHOLD = 12

/** 抽出結果の型 */
interface ExtractionResult {
  facts: string[]
  preferences: string[]
}

const FACT_EXTRACTION_PROMPT = `あなたはユーザープロフィール抽出の専門家です。
以下の会話から、ユーザーについて永久に記憶すべき情報を2カテゴリに分けて抽出してください。

■ FACTS（客観的事実）
抽出対象:
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

■ PREFERENCES（AIとの対話スタイル設定）
抽出対象:
- 呼び方の希望（「○○と呼んで」「敬語で話して」「タメ口でいい」）
- 応答スタイルの好み（「詳しく説明して」「簡潔に」「例を多く」）
- 話題の好み（「政治の話はしないで」「毎朝天気を教えて」）
- AIへの要望（「褒めて」「厳しく」「冗談を入れて」）

■ 抽出しない:
- 一時的な興味や関心（「最近○○にハマっている」）
- その場限りの希望（「今日はカレーが食べたい」）
- 会話の相談内容や質問そのもの
- 上記カテゴリに該当しない情報

■ ルール:
- 各項目は最大50文字
- ユーザーが明言した内容のみ（推測は含めない）
- 既に記録済みの内容と重複するものは出力しない
- FACTSは最大10個、PREFERENCESは最大5個
- 該当がなければそのカテゴリは空配列

■ 出力形式（JSON のみ、他のテキストは一切不要）:
{"facts":["事実1","事実2"],"preferences":["設定1","設定2"]}`

const FACT_CONSOLIDATION_PROMPT = `あなたはAIアシスタントの記憶最適化エンジンです。
ユーザーに関する断片的な記憶（事実リスト）の件数を圧縮することがあなたの任務です。

ルール:
1. 関連情報の統合: 意味的に関連する複数の事実は、1つの論理的な文に統合する
   (例: 「Pythonが好き」+「Reactを勉強中」+「AWSを使っている」 → 「Python, React, AWSを用いたWeb開発スキルを持つ」)
2. 情報の保持: 家族構成、健康状態、仕事、重要な趣味などの「ユーザーのコアアイデンティティ」に関わる情報は絶対に削除しない
3. 推測の排除: 提供されたリストに含まれない情報を捏造・推測して追加しない
4. 文字数制限: 統合後の各項目は最大50文字以内
5. 件数目標: 元の件数の60〜70%程度に圧縮する
6. 出力形式: 統合された事実リストのみを、1行1事実で出力する（番号・記号は不要）`

/**
 * LLM レスポンスから抽出結果をパース
 *
 * JSON パースを試み、失敗時は旧フォーマット（1行1事実）にフォールバック。
 */
function parseExtractionResult(responseText: string): ExtractionResult {
  // JSON 部分を抽出（余計なテキストがある場合に対応）
  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0])
      const facts = (Array.isArray(parsed.facts) ? parsed.facts : [])
        .filter((f: unknown): f is string => typeof f === 'string' && f.length > 0 && f.length <= 50)
      const preferences = (Array.isArray(parsed.preferences) ? parsed.preferences : [])
        .filter((p: unknown): p is string => typeof p === 'string' && p.length > 0 && p.length <= 50)
      return { facts, preferences }
    } catch {
      console.warn('[ExtractFacts] JSON パース失敗 — テキストフォールバック')
    }
  }

  // フォールバック: 旧フォーマット（1行1事実 → すべて facts 扱い）
  const facts = responseText
    .split('\n')
    .map((line) => line.replace(/^[-・•]\s*/, '').trim())
    .filter((line) => line.length > 0 && line.length <= 50)
  return { facts, preferences: [] }
}

/**
 * 永久記憶の統合（consolidation）
 *
 * 件数が閾値を超えた場合に、LLM を使って意味的に関連する項目を統合し件数を圧縮する。
 */
async function consolidateItems(items: string[], category: 'facts' | 'preferences'): Promise<string[]> {
  const label = category === 'facts' ? '事実' : '設定'
  console.log(`[ExtractFacts] ${label}統合開始: ${items.length} 件`)

  const itemsText = items.map((f) => `- ${f}`).join('\n')
  const userPrompt = `以下の ${items.length} 件の${label}リストを統合・最適化してください:\n\n${itemsText}`

  try {
    const result = await bedrock.send(new ConverseCommand({
      modelId: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0',
      messages: [{ role: 'user', content: [{ text: userPrompt }] }],
      system: [{ text: FACT_CONSOLIDATION_PROMPT }],
      inferenceConfig: { maxTokens: 2048, temperature: 0.2 },
    }))

    const responseText = (result.output?.message?.content ?? [])
      .filter((block): block is { text: string } => 'text' in block && typeof block.text === 'string')
      .map((block) => block.text)
      .join('')

    if (!responseText) {
      console.warn(`[ExtractFacts] ${label}統合結果が空 — 元のリストを維持`)
      return items
    }

    const consolidated = responseText
      .split('\n')
      .map((line) => line.replace(/^[-・•\d.]\s*/, '').trim())
      .filter((line) => line.length > 0 && line.length <= 50)

    // 統合結果が妥当でない場合はフォールバック
    if (consolidated.length === 0 || consolidated.length > items.length) {
      console.warn(`[ExtractFacts] ${label}統合結果が不正（${consolidated.length} 件）— 元のリストを維持`)
      return items
    }

    console.log(`[ExtractFacts] ${label}統合完了: ${items.length} → ${consolidated.length} 件`)
    return consolidated
  } catch (error) {
    console.warn(`[ExtractFacts] ${label}統合エラー — 元のリストを維持:`, error)
    return items
  }
}

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

  // 2. 既存の永久記憶を取得（facts + preferences）
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
  const existingPreferences = (existingResult.Item?.preferences?.L ?? [])
    .map((item) => item.S ?? '')
    .filter(Boolean)

  // 3. 会話テキストを構築
  const conversationText = messages
    .map((m) => `${m.role === 'user' ? 'ユーザー' : 'アシスタント'}: ${m.content}`)
    .join('\n')

  let userPrompt: string
  const existingParts: string[] = []
  if (existingFacts.length > 0) {
    existingParts.push(`記録済みFACTS:\n${existingFacts.map((f) => `- ${f}`).join('\n')}`)
  }
  if (existingPreferences.length > 0) {
    existingParts.push(`記録済みPREFERENCES:\n${existingPreferences.map((p) => `- ${p}`).join('\n')}`)
  }
  if (existingParts.length > 0) {
    userPrompt = `${existingParts.join('\n\n')}\n\n会話：\n${conversationText}`
  } else {
    userPrompt = `会話：\n${conversationText}`
  }

  // 4. Haiku 4.5 で事実抽出（JSON出力）
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

  // 5. JSON をパース
  const extracted = parseExtractionResult(responseText)

  if (extracted.facts.length === 0 && extracted.preferences.length === 0) {
    console.log('[ExtractFacts] パース後の新規事実なし')
    await deleteActiveSession(userId, sessionId, themeId)
    return
  }

  console.log(`[ExtractFacts] 新規 facts=${extracted.facts.length} 件, preferences=${extracted.preferences.length} 件`)
  if (extracted.facts.length > 0) console.log(`[ExtractFacts] facts: ${extracted.facts.join(' / ')}`)
  if (extracted.preferences.length > 0) console.log(`[ExtractFacts] preferences: ${extracted.preferences.join(' / ')}`)

  // 6. 既存とマージ
  let mergedFacts = [...existingFacts, ...extracted.facts]
  let mergedPreferences = [...existingPreferences, ...extracted.preferences]

  // 7. 閾値を超えた場合は LLM で統合して圧縮（カテゴリ別）
  if (mergedFacts.length >= FACTS_CONSOLIDATION_THRESHOLD) {
    mergedFacts = await consolidateItems(mergedFacts, 'facts')
  }
  if (mergedPreferences.length >= PREFERENCES_CONSOLIDATION_THRESHOLD) {
    mergedPreferences = await consolidateItems(mergedPreferences, 'preferences')
  }

  // 上限を超える場合は古いものから押し出し（統合後のフォールバック）
  if (mergedFacts.length > MAX_FACTS) {
    mergedFacts = mergedFacts.slice(-MAX_FACTS)
  }
  if (mergedPreferences.length > MAX_PREFERENCES) {
    mergedPreferences = mergedPreferences.slice(-MAX_PREFERENCES)
  }

  // 8. PERMANENT_FACTS レコードを更新（facts + preferences）
  const now = new Date().toISOString()
  await dynamo.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: { S: `USER#${userId}` },
      SK: { S: 'PERMANENT_FACTS' },
    },
    UpdateExpression: 'SET facts = :facts, preferences = :prefs, lastUpdatedAt = :now',
    ExpressionAttributeValues: {
      ':facts': { L: mergedFacts.map((f) => ({ S: f })) },
      ':prefs': { L: mergedPreferences.map((p) => ({ S: p })) },
      ':now': { S: now },
    },
  }))

  console.log(`[ExtractFacts] 永久記憶更新完了 (facts=${mergedFacts.length}, preferences=${mergedPreferences.length})`)

  // 9. ACTIVE_SESSION レコードを削除
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
