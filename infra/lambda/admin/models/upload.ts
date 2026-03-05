import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { marshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import * as crypto from 'crypto'
import { requireAdmin, isErrorResponse, response } from '../middleware'

const dynamodb = new DynamoDBClient({})
const s3 = new S3Client({})
const TABLE_NAME = process.env.TABLE_NAME!
const MODELS_BUCKET = process.env.MODELS_BUCKET!

/**
 * ZIP内の model3.json を解析して表情・モーション一覧を抽出
 */
function parseModel3Json(model3Json: Record<string, unknown>) {
  const fileRefs = model3Json.FileReferences as Record<string, unknown> | undefined
  if (!fileRefs) return { expressions: [], motions: [], mocFile: '', textures: [] as string[] }

  // 表情一覧
  const expressions = (fileRefs.Expressions as Array<{ Name: string; File: string }> ?? [])
    .map((e) => ({ name: e.Name, file: e.File }))

  // モーション一覧
  const motionGroups = fileRefs.Motions as Record<string, Array<{ File: string }>> | undefined
  const motions: Array<{ group: string; index: number; file: string }> = []
  if (motionGroups) {
    for (const [group, list] of Object.entries(motionGroups)) {
      for (let i = 0; i < list.length; i++) {
        motions.push({ group, index: i, file: list[i].File })
      }
    }
  }

  const mocFile = (fileRefs.Moc as string) ?? ''
  const textures = (fileRefs.Textures as string[]) ?? []

  return { expressions, motions, mocFile, textures }
}

/**
 * POST /admin/models — モデルをアップロード（Base64 ZIP）
 *
 * リクエストボディ:
 *   name: モデル名
 *   description: 説明
 *   files: { [relativePath]: base64Content }  ← ZIP 展開済みのファイルマップ
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const authResult = await requireAdmin(event)
  if (isErrorResponse(authResult)) return authResult

  if (!event.body) {
    return response(400, { error: 'Request body is required' })
  }

  try {
    const { name, description, files } = JSON.parse(event.body) as {
      name: string
      description?: string
      files: Record<string, string>
    }

    if (!name || typeof name !== 'string') {
      return response(400, { error: 'name is required' })
    }
    if (!files || typeof files !== 'object' || Object.keys(files).length === 0) {
      return response(400, { error: 'files is required' })
    }

    // model3.json を探す
    const model3Entry = Object.entries(files).find(([path]) => path.endsWith('.model3.json'))
    if (!model3Entry) {
      return response(400, { error: '.model3.json file not found in uploaded files' })
    }

    // model3.json を解析
    const model3Json = JSON.parse(Buffer.from(model3Entry[1], 'base64').toString('utf-8'))
    const { expressions, motions, mocFile, textures } = parseModel3Json(model3Json)

    // .moc3 ファイルの存在確認
    if (!mocFile || !Object.keys(files).some((p) => p.endsWith(mocFile))) {
      return response(400, { error: '.moc3 file not found' })
    }

    const modelId = crypto.randomUUID()
    const s3Prefix = `models/${modelId}/`

    // S3 にファイルをアップロード
    for (const [filePath, base64Content] of Object.entries(files)) {
      const contentType = getContentType(filePath)
      await s3.send(new PutObjectCommand({
        Bucket: MODELS_BUCKET,
        Key: `${s3Prefix}${filePath}`,
        Body: Buffer.from(base64Content, 'base64'),
        ContentType: contentType,
      }))
    }

    // model3.json のファイル名（相対パス）
    const model3FileName = model3Entry[0]

    // デフォルトの感情→表情マッピング（表情数に応じて自動生成）
    const defaultEmotionMapping: Record<string, string> = {}
    const emotionNames = ['neutral', 'happy', 'thinking', 'surprised', 'sad', 'embarrassed', 'troubled', 'angry']
    for (let i = 0; i < Math.min(expressions.length, emotionNames.length); i++) {
      defaultEmotionMapping[emotionNames[i]] = expressions[i].name
    }

    // デフォルトのモーション→タグマッピング
    const defaultMotionMapping: Record<string, { group: string; index: number }> = {}
    const motionTags = ['idle', 'bow', 'smile', 'think', 'nod', 'wave']
    for (let i = 0; i < Math.min(motions.length, motionTags.length); i++) {
      defaultMotionMapping[motionTags[i]] = { group: motions[i].group, index: motions[i].index }
    }

    const now = new Date().toISOString()

    // DynamoDB にメタデータを保存
    const item: Record<string, unknown> = {
      PK: `GLOBAL_MODEL#${modelId}`,
      SK: 'METADATA',
      modelId,
      name: name.slice(0, 50),
      description: (description ?? '').slice(0, 200),
      s3Prefix,
      modelFile: model3FileName,
      status: 'active',
      expressions,
      motions,
      textures,
      emotionMapping: defaultEmotionMapping,
      motionMapping: defaultMotionMapping,
      createdAt: now,
      updatedAt: now,
    }

    await dynamodb.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall(item, { removeUndefinedValues: true }),
    }))

    return response(200, {
      modelId,
      name: item.name,
      s3Prefix,
      modelFile: model3FileName,
      expressions,
      motions,
      emotionMapping: defaultEmotionMapping,
      motionMapping: defaultMotionMapping,
    })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    console.error('モデルアップロードエラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}

function getContentType(filePath: string): string {
  if (filePath.endsWith('.json')) return 'application/json'
  if (filePath.endsWith('.png')) return 'image/png'
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg'
  if (filePath.endsWith('.moc3')) return 'application/octet-stream'
  if (filePath.endsWith('.motion3.json')) return 'application/json'
  if (filePath.endsWith('.exp3.json')) return 'application/json'
  if (filePath.endsWith('.physics3.json')) return 'application/json'
  if (filePath.endsWith('.pose3.json')) return 'application/json'
  if (filePath.endsWith('.cdi3.json')) return 'application/json'
  return 'application/octet-stream'
}
