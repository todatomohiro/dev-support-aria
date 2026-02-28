import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { exchangeCodeForTokens, saveGoogleTokens } from '../llm/skills/tokenManager'

/**
 * POST /skills/google/callback — 認可コードをトークンに交換して保存
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  if (!event.body) {
    return response(400, { error: 'Request body is required' })
  }

  let code: string
  let redirectUri: string

  try {
    const body = JSON.parse(event.body)
    code = body.code
    redirectUri = body.redirectUri

    if (!code || typeof code !== 'string') {
      return response(400, { error: 'code is required' })
    }
    if (!redirectUri || typeof redirectUri !== 'string') {
      return response(400, { error: 'redirectUri is required' })
    }
  } catch {
    return response(400, { error: 'Invalid JSON' })
  }

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri)

    await saveGoogleTokens(userId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    })

    return response(200, { success: true })
  } catch (error) {
    console.error('[Skills] OAuth callback エラー:', error)
    const message = error instanceof Error ? error.message : 'トークン交換に失敗しました'
    return response(500, { error: message })
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
