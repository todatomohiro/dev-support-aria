import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/** スニペット生成時の前後文字数 */
const SNIPPET_RADIUS = 50

/**
 * アシスタントメッセージの JSON content から text を抽出
 */
function extractTextFromContent(content: string): string {
  try {
    const parsed = JSON.parse(content)
    if (typeof parsed.text === 'string') return parsed.text
  } catch { /* 全体が JSON ではない */ }

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      if (typeof parsed.text === 'string') return parsed.text
    }
  } catch { /* JSON パース失敗 */ }

  if (!content.trimStart().startsWith('{')) {
    const jsonStart = content.indexOf('{"')
    if (jsonStart > 0) {
      return content.slice(0, jsonStart).trim()
    }
  }

  const idx = content.indexOf('{"text"')
  if (idx > 0) {
    return content.slice(0, idx).trim()
  }

  return content
}

/**
 * マッチ箇所周辺のスニペットを生成
 */
function createSnippet(text: string, query: string): string {
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const matchIndex = lowerText.indexOf(lowerQuery)

  if (matchIndex === -1) {
    return text.slice(0, SNIPPET_RADIUS * 2)
  }

  const start = Math.max(0, matchIndex - SNIPPET_RADIUS)
  const end = Math.min(text.length, matchIndex + query.length + SNIPPET_RADIUS)

  let snippet = text.slice(start, end)
  if (start > 0) snippet = '...' + snippet
  if (end < text.length) snippet = snippet + '...'

  return snippet
}

/**
 * GET /search?q=keyword — トピック・メッセージ・メモ横断検索
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  const query = event.queryStringParameters?.q?.trim()
  if (!query) {
    return response(400, { error: 'q (search query) is required' })
  }

  const lowerQuery = query.toLowerCase()

  try {
    // トピック・メモを並列取得
    const [topicsResult, memosResult] = await Promise.all([
      client.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': { S: `USER#${userId}` },
          ':prefix': { S: 'THEME_SESSION#' },
        },
        ScanIndexForward: false,
      })),
      client.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': { S: `USER#${userId}` },
          ':prefix': { S: 'MEMO#' },
        },
        ScanIndexForward: false,
      })),
    ])

    // ── トピック名マッチ ──
    const allTopics = (topicsResult.Items ?? []).map((item) => {
      const m = unmarshall(item)
      return {
        themeId: m.themeId,
        themeName: m.themeName ?? '',
        category: m.category ?? 'free',
        updatedAt: m.updatedAt ?? m.createdAt ?? '',
      }
    })

    const topics = allTopics
      .filter((t) => t.themeName.toLowerCase().includes(lowerQuery))
      .slice(0, 20)
      .map((t) => ({
        themeId: t.themeId,
        themeName: t.themeName,
        category: t.category,
        updatedAt: t.updatedAt,
      }))

    // ── メッセージ検索（直近10トピックのメッセージを検索）──
    const recentTopics = allTopics
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 10)

    const messageResults = await Promise.all(
      recentTopics.map((t) =>
        client.send(new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: {
            ':pk': { S: `USER#${userId}#THEME#${t.themeId}` },
            ':prefix': { S: 'MSG#' },
          },
          ScanIndexForward: false,
          Limit: 200,
        })).then((result) => ({
          themeId: t.themeId,
          themeName: t.themeName,
          items: result.Items ?? [],
        }))
      )
    )

    const messages: Array<{
      themeId: string
      themeName: string
      role: string
      snippet: string
      timestamp: string
    }> = []

    for (const { themeId, themeName, items } of messageResults) {
      for (const item of items) {
        const role = item.role?.S ?? 'user'
        const rawContent = item.content?.S ?? ''
        const content = role === 'assistant' ? extractTextFromContent(rawContent) : rawContent

        if (content.toLowerCase().includes(lowerQuery)) {
          messages.push({
            themeId,
            themeName,
            role,
            snippet: createSnippet(content, query),
            timestamp: item.createdAt?.S ?? '',
          })
        }
      }
      // 十分な結果が集まったら打ち切り
      if (messages.length >= 30) break
    }

    // ── メモ検索 ──
    const memos = (memosResult.Items ?? [])
      .map((item) => {
        const m = unmarshall(item)
        return {
          memoId: m.memoId as string,
          title: m.title as string,
          content: m.content as string,
          tags: (m.tags ?? []) as string[],
          createdAt: m.createdAt as string,
        }
      })
      .filter((m) =>
        m.title.toLowerCase().includes(lowerQuery) ||
        m.content.toLowerCase().includes(lowerQuery) ||
        m.tags.some((t) => t.toLowerCase().includes(lowerQuery))
      )
      .slice(0, 20)
      .map((m) => ({
        memoId: m.memoId,
        title: m.title,
        snippet: createSnippet(m.content, query),
        tags: m.tags,
        createdAt: m.createdAt,
      }))

    return response(200, { topics, messages, memos })
  } catch (error) {
    console.error('検索エラー:', error)
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
