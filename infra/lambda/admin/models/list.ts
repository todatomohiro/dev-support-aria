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
    const result = await dynamodb.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
      ExpressionAttributeValues: {
        ':prefix': { S: 'GLOBAL_MODEL#' },
        ':sk': { S: 'METADATA' },
      },
    }))

    const models = (result.Items ?? [])
      .map((item) => {
        const m = unmarshall(item)
        return {
          modelId: m.modelId,
          name: m.name,
          description: m.description ?? '',
          s3Prefix: m.s3Prefix,
          modelFile: m.modelFile,
          status: m.status,
          expressions: m.expressions ?? [],
          motions: m.motions ?? [],
          emotionMapping: m.emotionMapping ?? {},
          motionMapping: m.motionMapping ?? {},
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
        }
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    return response(200, { models })
  } catch (error) {
    console.error('モデル一覧取得エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}
