import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { requireAdmin, isErrorResponse, response } from '../middleware'

const s3 = new S3Client({})
const dynamodb = new DynamoDBClient({})
const MODELS_BUCKET = process.env.MODELS_BUCKET!
const MODELS_CDN_BASE = process.env.MODELS_CDN_BASE ?? ''
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * POST /admin/models/{modelId}/avatar — アバター画像アップロード用 Presigned URL 取得
 *
 * リクエストボディ:
 *   contentType: 'image/png' | 'image/jpeg' | 'image/webp'
 *
 * レスポンス:
 *   uploadUrl: Presigned PUT URL
 *   avatarUrl: CDN URL（アップロード完了後にこの URL で参照可能）
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const authResult = await requireAdmin(event)
  if (isErrorResponse(authResult)) return authResult

  const modelId = event.pathParameters?.modelId
  if (!modelId) {
    return response(400, { error: 'modelId is required' })
  }

  if (!event.body) {
    return response(400, { error: 'Request body is required' })
  }

  try {
    const { contentType } = JSON.parse(event.body) as { contentType: string }

    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp']
    if (!contentType || !allowedTypes.includes(contentType)) {
      return response(400, { error: `contentType must be one of: ${allowedTypes.join(', ')}` })
    }

    const ext = contentType === 'image/png' ? 'png' : contentType === 'image/jpeg' ? 'jpg' : 'webp'
    const s3Key = `models/${modelId}/avatar.${ext}`

    // Presigned PUT URL を生成（有効期限15分）
    const command = new PutObjectCommand({
      Bucket: MODELS_BUCKET,
      Key: s3Key,
      ContentType: contentType,
      CacheControl: 'max-age=86400',
    })
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 })

    // CDN URL（キャッシュバスト用にタイムスタンプ付加）
    const avatarUrl = MODELS_CDN_BASE
      ? `${MODELS_CDN_BASE}/${s3Key}`
      : ''

    // DynamoDB に avatarUrl を保存
    await dynamodb.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({
        PK: `GLOBAL_MODEL#${modelId}`,
        SK: 'METADATA',
      }),
      UpdateExpression: 'SET avatarUrl = :avatarUrl, updatedAt = :updatedAt',
      ExpressionAttributeValues: marshall({
        ':avatarUrl': avatarUrl,
        ':updatedAt': new Date().toISOString(),
      }),
      ConditionExpression: 'attribute_exists(PK)',
    }))

    return response(200, { uploadUrl, avatarUrl })
  } catch (error: unknown) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      return response(404, { error: 'Model not found' })
    }
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    console.error('アバターアップロードエラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}
