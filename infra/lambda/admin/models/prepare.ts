import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import * as crypto from 'crypto'
import { requireAdmin, isErrorResponse, response } from '../middleware'

const s3 = new S3Client({})
const MODELS_BUCKET = process.env.MODELS_BUCKET!

/** ファイル拡張子から Content-Type を推定 */
function getContentType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase()
  const types: Record<string, string> = {
    json: 'application/json',
    moc3: 'application/octet-stream',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    motion3: 'application/json',
  }
  return types[ext ?? ''] ?? 'application/octet-stream'
}

/**
 * POST /admin/models/prepare — アップロード準備
 *
 * リクエストボディ:
 *   name: モデル名
 *   description: 説明（任意）
 *   filePaths: string[]  ← ZIP 展開後の相対パス一覧
 *
 * レスポンス:
 *   modelId: 生成されたモデルID
 *   uploadUrls: { [relativePath]: presignedUrl }
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const authResult = await requireAdmin(event)
  if (isErrorResponse(authResult)) return authResult

  if (!event.body) {
    return response(400, { error: 'Request body is required' })
  }

  try {
    const { name, filePaths } = JSON.parse(event.body) as {
      name: string
      filePaths: string[]
    }

    if (!name || typeof name !== 'string') {
      return response(400, { error: 'name is required' })
    }
    if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
      return response(400, { error: 'filePaths is required' })
    }

    // model3.json の存在チェック
    if (!filePaths.some((p) => p.endsWith('.model3.json'))) {
      return response(400, { error: '.model3.json file not found in filePaths' })
    }

    const modelId = crypto.randomUUID()
    const s3Prefix = `models/${modelId}/`

    // 各ファイルの Presigned PUT URL を生成（有効期限15分）
    const uploadUrls: Record<string, string> = {}
    for (const filePath of filePaths) {
      const key = `${s3Prefix}${filePath}`
      const command = new PutObjectCommand({
        Bucket: MODELS_BUCKET,
        Key: key,
        CacheControl: 'max-age=31536000, immutable',
        ContentType: getContentType(filePath),
      })
      uploadUrls[filePath] = await getSignedUrl(s3, command, { expiresIn: 900 })
    }

    return response(200, { modelId, uploadUrls })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    console.error('prepare エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}
