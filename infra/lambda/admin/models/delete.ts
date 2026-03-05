import { DynamoDBClient, DeleteItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb'
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { requireAdmin, isErrorResponse, response } from '../middleware'

const dynamodb = new DynamoDBClient({})
const s3 = new S3Client({})
const TABLE_NAME = process.env.TABLE_NAME!
const MODELS_BUCKET = process.env.MODELS_BUCKET!

/**
 * DELETE /admin/models/{modelId} — モデルを削除（S3 + DynamoDB）
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const authResult = await requireAdmin(event)
  if (isErrorResponse(authResult)) return authResult

  const modelId = event.pathParameters?.modelId
  if (!modelId) {
    return response(400, { error: 'modelId is required' })
  }

  try {
    // メタデータを取得して s3Prefix を確認
    const getResult = await dynamodb.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({
        PK: `GLOBAL_MODEL#${modelId}`,
        SK: 'METADATA',
      }),
    }))

    if (!getResult.Item) {
      return response(404, { error: 'Model not found' })
    }

    const meta = unmarshall(getResult.Item)
    const s3Prefix = meta.s3Prefix as string

    // S3 からファイルを削除
    if (s3Prefix) {
      const listResult = await s3.send(new ListObjectsV2Command({
        Bucket: MODELS_BUCKET,
        Prefix: s3Prefix,
      }))

      const objects = (listResult.Contents ?? []).map((obj) => ({ Key: obj.Key! }))
      if (objects.length > 0) {
        await s3.send(new DeleteObjectsCommand({
          Bucket: MODELS_BUCKET,
          Delete: { Objects: objects },
        }))
      }
    }

    // DynamoDB からメタデータを削除
    await dynamodb.send(new DeleteItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({
        PK: `GLOBAL_MODEL#${modelId}`,
        SK: 'METADATA',
      }),
    }))

    return response(200, { modelId, deleted: true })
  } catch (error) {
    console.error('モデル削除エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}
