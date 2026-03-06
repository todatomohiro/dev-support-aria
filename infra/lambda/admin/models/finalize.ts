import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { marshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
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
 * POST /admin/models/{modelId}/finalize — S3 上のファイルからメタデータ登録
 *
 * リクエストボディ:
 *   name: モデル名
 *   description: 説明（任意）
 *   model3Path: model3.json の相対パス
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
    const { name, description, model3Path } = JSON.parse(event.body) as {
      name: string
      description?: string
      model3Path: string
    }

    if (!name || typeof name !== 'string') {
      return response(400, { error: 'name is required' })
    }
    if (!model3Path || !model3Path.endsWith('.model3.json')) {
      return response(400, { error: 'model3Path is required' })
    }

    const s3Prefix = `models/${modelId}/`

    // S3 から model3.json を読み込み
    const model3Obj = await s3.send(new GetObjectCommand({
      Bucket: MODELS_BUCKET,
      Key: `${s3Prefix}${model3Path}`,
    }))
    const model3Text = await model3Obj.Body!.transformToString('utf-8')
    const model3Json = JSON.parse(model3Text)
    let { expressions, motions, mocFile, textures } = parseModel3Json(model3Json)

    if (!mocFile) {
      return response(400, { error: '.moc3 file not found in model3.json' })
    }

    // model3.json に Expressions が未定義の場合、S3 上の .exp3.json を自動検出
    if (expressions.length === 0) {
      const listResult = await s3.send(new ListObjectsV2Command({
        Bucket: MODELS_BUCKET,
        Prefix: s3Prefix,
      }))
      const expFiles = (listResult.Contents ?? [])
        .map((obj) => obj.Key!)
        .filter((key) => key.endsWith('.exp3.json'))
        .sort()
      expressions = expFiles.map((key) => {
        const relativePath = key.replace(s3Prefix, '')
        const fileName = relativePath.split('/').pop() ?? relativePath
        const name = fileName.replace('.exp3.json', '')
        return { name, file: relativePath }
      })
    }

    // デフォルトの感情→表情マッピング
    const defaultEmotionMapping: Record<string, string> = {}
    const emotionNames = ['neutral', 'happy', 'thinking', 'surprised', 'sad', 'embarrassed', 'troubled', 'angry']
    for (let i = 0; i < Math.min(expressions.length, emotionNames.length); i++) {
      defaultEmotionMapping[emotionNames[i]] = expressions[i].name
    }

    // デフォルトのモーション→タグマッピング
    const defaultMotionMapping: Record<string, { group: string; index: number }> = {}
    const motionTags = ['idle', 'happy', 'thinking', 'surprised', 'sad', 'embarrassed', 'troubled', 'angry', 'motion1', 'motion2', 'motion3', 'motion4', 'motion5', 'motion6']
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
      modelFile: model3Path,
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
      modelFile: model3Path,
      expressions,
      motions,
      emotionMapping: defaultEmotionMapping,
      motionMapping: defaultMotionMapping,
    })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON or model3.json' })
    }
    console.error('finalize エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}
