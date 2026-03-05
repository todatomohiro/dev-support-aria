import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const dynamodb = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!
const MODELS_CDN_BASE = process.env.MODELS_CDN_BASE ?? ''

/**
 * GET /models — 有効なモデル一覧を取得（ユーザー向け）
 *
 * active なモデルのみ返却。CDN URL を付与してフロントエンドから直接読み込めるようにする。
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  try {
    const result = await dynamodb.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk AND #st = :active',
      ExpressionAttributeValues: {
        ':prefix': { S: 'GLOBAL_MODEL#' },
        ':sk': { S: 'METADATA' },
        ':active': { S: 'active' },
      },
      ExpressionAttributeNames: {
        '#st': 'status',
      },
    }))

    const models = (result.Items ?? [])
      .map((item) => {
        const m = unmarshall(item)
        const modelUrl = MODELS_CDN_BASE
          ? `${MODELS_CDN_BASE}/${m.s3Prefix}${m.modelFile}`
          : ''
        return {
          modelId: m.modelId,
          name: m.name,
          description: m.description ?? '',
          modelUrl,
          s3Prefix: m.s3Prefix,
          modelFile: m.modelFile,
          emotionMapping: m.emotionMapping ?? {},
          motionMapping: m.motionMapping ?? {},
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    return response(200, { models })
  } catch (error) {
    console.error('モデル一覧取得エラー:', error)
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
