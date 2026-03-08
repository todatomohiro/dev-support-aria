import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * アシスタントメッセージの JSON content から text を抽出
 */
function extractTextFromContent(content: string): string {
  // 1. 全体を JSON として解析
  try {
    const parsed = JSON.parse(content)
    if (typeof parsed.text === 'string') return parsed.text
  } catch { /* 全体が JSON ではない */ }

  // 2. 正規表現で JSON ブロックを抽出
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      if (typeof parsed.text === 'string') return parsed.text
    }
  } catch { /* JSON パース失敗 */ }

  // 3. フォールバック: 平文テキスト + JSON メタデータが混在する場合
  // 最初のトップレベル JSON オブジェクト以降を除去
  if (!content.trimStart().startsWith('{')) {
    // `{"` または `{\n` で始まる JSON ブロックを検出
    const jsonStart = content.search(/\{[\s]*"/)
    if (jsonStart > 0) {
      return content.slice(0, jsonStart).trim()
    }
  }

  return content
}

/**
 * GET /themes/{themeId}/messages — テーマのメッセージ一覧を取得
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  const themeId = event.pathParameters?.themeId
  if (!themeId) {
    return response(400, { error: 'themeId is required' })
  }

  const limit = Math.min(
    parseInt(event.queryStringParameters?.limit ?? '100', 10) || 100,
    500
  )

  try {
    const result = await client.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${userId}#THEME#${themeId}` },
        ':prefix': { S: 'MSG#' },
      },
      ScanIndexForward: false,
      Limit: limit,
    }))

    const roleOrder: Record<string, number> = { user: 0, assistant: 1 }

    // chat Lambda 形式のメッセージを frontend Message 形式に変換
    const messages = (result.Items ?? [])
      .map((item) => {
        const role = item.role?.S ?? 'user'
        const rawContent = item.content?.S ?? ''
        // アシスタントの JSON レスポンスから text のみ抽出
        const content = role === 'assistant' ? extractTextFromContent(rawContent) : rawContent
        return {
          id: item.SK?.S ?? '',
          role,
          content,
          timestamp: item.createdAt?.S ? new Date(item.createdAt.S).getTime() : 0,
        }
      })
      // 時系列順にソート（同一タイムスタンプ内は user → assistant の順）
      .sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp
        return (roleOrder[a.role] ?? 0) - (roleOrder[b.role] ?? 0)
      })

    return response(200, { messages })
  } catch (error) {
    console.error('テーマメッセージ取得エラー:', error)
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
