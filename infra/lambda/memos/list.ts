import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * GET /memos — メモ一覧を取得（検索対応）
 *
 * クエリパラメータ:
 *   query: 検索キーワード（タイトル・タグのフィルタリング）
 *   limit: 取得件数（デフォルト 50）
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  try {
    const query = event.queryStringParameters?.query?.toLowerCase()
    const limit = Math.min(parseInt(event.queryStringParameters?.limit ?? '50', 10), 100)

    const result = await client.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${userId}` },
        ':skPrefix': { S: 'MEMO#' },
      },
      ScanIndexForward: false,
    }))

    let memos = (result.Items ?? []).map((item) => {
      const m = unmarshall(item)
      return {
        memoId: m.memoId,
        title: m.title,
        content: m.content,
        tags: m.tags ?? [],
        source: m.source ?? 'chat',
        createdAt: m.createdAt,
      }
    })

    // createdAt 降順ソート
    memos.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    // キーワードフィルタリング
    if (query) {
      memos = memos.filter((m) =>
        m.title.toLowerCase().includes(query) ||
        m.content.toLowerCase().includes(query) ||
        m.tags.some((t: string) => t.toLowerCase().includes(query))
      )
    }

    return response(200, { memos: memos.slice(0, limit), total: memos.length })
  } catch (error) {
    console.error('メモ一覧取得エラー:', error)
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
