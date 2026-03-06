import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { requireAdmin, isErrorResponse, response } from '../middleware'

const dynamodb = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * GET /admin/models — モデル一覧を取得
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const authResult = await requireAdmin(event)
  if (isErrorResponse(authResult)) return authResult

  try {
    // ページネーション対応 Scan（テーブルが大きい場合に備える）
    const allItems: Record<string, unknown>[] = []
    let lastKey: Record<string, unknown> | undefined
    do {
      const result = await dynamodb.send(new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
        ExpressionAttributeValues: {
          ':prefix': { S: 'GLOBAL_MODEL#' },
          ':sk': { S: 'METADATA' },
        },
        ...(lastKey ? { ExclusiveStartKey: lastKey as Record<string, { S: string }> } : {}),
      }))
      if (result.Items) allItems.push(...result.Items.map((item) => unmarshall(item)))
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined
    } while (lastKey)

    const models = allItems
      .map((m) => ({
        modelId: m.modelId as string,
        name: m.name as string,
        description: (m.description as string) ?? '',
        s3Prefix: m.s3Prefix as string,
        modelFile: m.modelFile as string,
        status: m.status as string,
        expressions: (m.expressions as unknown[]) ?? [],
        motions: (m.motions as unknown[]) ?? [],
        emotionMapping: (m.emotionMapping as Record<string, string>) ?? {},
        motionMapping: (m.motionMapping as Record<string, { group: string; index: number }>) ?? {},
        characterConfig: (m.characterConfig as Record<string, unknown>) ?? undefined,
        createdAt: m.createdAt as string,
        updatedAt: m.updatedAt as string,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    return response(200, { models })
  } catch (error) {
    console.error('モデル一覧取得エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}
