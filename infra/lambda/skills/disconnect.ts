import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { deleteGoogleTokens } from '../llm/skills/tokenManager'

/**
 * DELETE /skills/google/disconnect — Google 連携を解除
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  try {
    await deleteGoogleTokens(userId)
    return response(200, { success: true })
  } catch (error) {
    console.error('[Skills] Google 連携解除エラー:', error)
    return response(500, { error: '連携解除に失敗しました' })
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
