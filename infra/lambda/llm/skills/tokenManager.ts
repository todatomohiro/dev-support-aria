import { DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb'

const dynamo = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME ?? 'butler-assistant'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? ''
const GOOGLE_IOS_CLIENT_ID = process.env.GOOGLE_IOS_CLIENT_ID ?? ''

type OAuthPlatform = 'web' | 'ios'

interface GoogleTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  platform?: OAuthPlatform
}

/**
 * リダイレクト URI からプラットフォームを判定
 */
function detectPlatform(redirectUri: string): OAuthPlatform {
  return redirectUri.startsWith('com.googleusercontent.apps.') ? 'ios' : 'web'
}

/**
 * プラットフォームに応じた Google クライアント認証情報を取得
 *
 * iOS クライアントはパブリッククライアントのため client_secret なし。
 */
function getClientCredentials(platform: OAuthPlatform): { clientId: string; clientSecret?: string } {
  if (platform === 'ios') {
    return { clientId: GOOGLE_IOS_CLIENT_ID }
  }
  return { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET }
}

/**
 * Google OAuth トークンリクエストのパラメータを構築
 */
function buildTokenParams(
  credentials: { clientId: string; clientSecret?: string },
  params: Record<string, string>
): URLSearchParams {
  const allParams: Record<string, string> = {
    client_id: credentials.clientId,
    ...params,
  }
  if (credentials.clientSecret) {
    allParams.client_secret = credentials.clientSecret
  }
  return new URLSearchParams(allParams)
}

/**
 * DynamoDB からユーザーの Google トークンを取得し、期限切れなら自動リフレッシュ
 */
export async function getGoogleTokens(userId: string): Promise<GoogleTokens | null> {
  const result = await dynamo.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: { S: `USER#${userId}` },
      SK: { S: 'SKILL_CONN#google' },
    },
  }))

  if (!result.Item) {
    return null
  }

  const platform = (result.Item.platform?.S as OAuthPlatform) ?? 'web'
  const tokens: GoogleTokens = {
    accessToken: result.Item.accessToken?.S ?? '',
    refreshToken: result.Item.refreshToken?.S ?? '',
    expiresAt: Number(result.Item.expiresAt?.N ?? '0'),
    platform,
  }

  // トークンが期限切れの場合はリフレッシュ
  const now = Date.now()
  if (tokens.expiresAt < now - 60_000) {
    if (!tokens.refreshToken) {
      return null
    }

    const refreshed = await refreshGoogleTokens(tokens.refreshToken, platform)
    if (!refreshed) {
      return null
    }

    const updatedTokens: GoogleTokens = {
      accessToken: refreshed.access_token,
      refreshToken: tokens.refreshToken,
      expiresAt: now + refreshed.expires_in * 1000,
      platform,
    }

    await saveGoogleTokens(userId, updatedTokens)
    return updatedTokens
  }

  return tokens
}

/**
 * Google トークンを DynamoDB に保存
 */
export async function saveGoogleTokens(userId: string, tokens: GoogleTokens): Promise<void> {
  await dynamo.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: { S: `USER#${userId}` },
      SK: { S: 'SKILL_CONN#google' },
      accessToken: { S: tokens.accessToken },
      refreshToken: { S: tokens.refreshToken },
      expiresAt: { N: String(tokens.expiresAt) },
      platform: { S: tokens.platform ?? 'web' },
      connectedAt: { N: String(Date.now()) },
    },
  }))
}

/**
 * Google トークンを DynamoDB から削除
 */
export async function deleteGoogleTokens(userId: string): Promise<void> {
  await dynamo.send(new DeleteItemCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: { S: `USER#${userId}` },
      SK: { S: 'SKILL_CONN#google' },
    },
  }))
}

/**
 * Google OAuth リフレッシュトークンで新しいアクセストークンを取得
 */
async function refreshGoogleTokens(refreshToken: string, platform: OAuthPlatform = 'web'): Promise<{ access_token: string; expires_in: number } | null> {
  const credentials = getClientCredentials(platform)
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: buildTokenParams(credentials, {
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })

    if (!res.ok) {
      console.error('[TokenManager] トークンリフレッシュ失敗:', await res.text())
      return null
    }

    return await res.json() as { access_token: string; expires_in: number }
  } catch (error) {
    console.error('[TokenManager] トークンリフレッシュエラー:', error)
    return null
  }
}

/**
 * 認可コードをトークンに交換
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number; platform: OAuthPlatform }> {
  const platform = detectPlatform(redirectUri)
  const credentials = getClientCredentials(platform)
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: buildTokenParams(credentials, {
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!res.ok) {
    const errorBody = await res.text()
    throw new Error(`トークン交換に失敗しました: ${errorBody}`)
  }

  const tokens = await res.json() as { access_token: string; refresh_token: string; expires_in: number }
  return { ...tokens, platform }
}
