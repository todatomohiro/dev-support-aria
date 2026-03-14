import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { requireAdmin, isErrorResponse, response } from '../middleware'

const dynamodb = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

/**
 * PATCH /admin/models/{modelId} — モデルメタデータを更新
 *
 * 更新可能フィールド:
 *   name, description, status, emotionMapping, motionMapping
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
    const body = JSON.parse(event.body) as {
      name?: string
      description?: string
      status?: 'active' | 'inactive'
      modelTier?: 'standard' | 'platinum'
      emotionMapping?: Record<string, string>
      motionMapping?: Record<string, { group: string; index: number }>
      characterConfig?: {
        characterName: string
        characterAge: string
        characterGender: 'male' | 'female' | 'other' | ''
        characterPersonality: string
        characterSpeechStyle: string
        characterPrompt: string
      }
    }

    // 更新式を動的に構築
    const expressionNames: string[] = []
    const expressionValues: Record<string, unknown> = {}
    const expressionAttrNames: Record<string, string> = {}

    if (body.name !== undefined) {
      expressionNames.push('#name = :name')
      expressionValues[':name'] = body.name.slice(0, 50)
      expressionAttrNames['#name'] = 'name'
    }
    if (body.description !== undefined) {
      expressionNames.push('description = :description')
      expressionValues[':description'] = body.description.slice(0, 200)
    }
    if (body.status !== undefined) {
      expressionNames.push('#status = :status')
      expressionValues[':status'] = body.status
      expressionAttrNames['#status'] = 'status'
    }
    if (body.modelTier !== undefined) {
      expressionNames.push('modelTier = :modelTier')
      expressionValues[':modelTier'] = body.modelTier
    }
    if (body.emotionMapping !== undefined) {
      expressionNames.push('emotionMapping = :emotionMapping')
      expressionValues[':emotionMapping'] = body.emotionMapping
    }
    if (body.motionMapping !== undefined) {
      expressionNames.push('motionMapping = :motionMapping')
      expressionValues[':motionMapping'] = body.motionMapping
    }
    if (body.characterConfig !== undefined) {
      expressionNames.push('characterConfig = :characterConfig')
      expressionValues[':characterConfig'] = {
        characterName: (body.characterConfig.characterName ?? '').slice(0, 50),
        characterAge: (body.characterConfig.characterAge ?? '').slice(0, 10),
        characterGender: body.characterConfig.characterGender ?? '',
        characterPersonality: (body.characterConfig.characterPersonality ?? '').slice(0, 500),
        characterSpeechStyle: (body.characterConfig.characterSpeechStyle ?? '').slice(0, 500),
        characterPrompt: (body.characterConfig.characterPrompt ?? '').slice(0, 2000),
      }
    }

    if (expressionNames.length === 0) {
      return response(400, { error: 'No fields to update' })
    }

    // updatedAt を追加
    expressionNames.push('updatedAt = :updatedAt')
    expressionValues[':updatedAt'] = new Date().toISOString()

    const updateExpression = `SET ${expressionNames.join(', ')}`

    await dynamodb.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({
        PK: `GLOBAL_MODEL#${modelId}`,
        SK: 'METADATA',
      }),
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: marshall(expressionValues, { removeUndefinedValues: true }),
      ...(Object.keys(expressionAttrNames).length > 0 && {
        ExpressionAttributeNames: expressionAttrNames,
      }),
      ConditionExpression: 'attribute_exists(PK)',
    }))

    return response(200, { modelId, updated: true })
  } catch (error: unknown) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      return response(404, { error: 'Model not found' })
    }
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON' })
    }
    console.error('モデル更新エラー:', error)
    return response(500, { error: 'Internal server error' })
  }
}
