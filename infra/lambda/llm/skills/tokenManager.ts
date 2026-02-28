import { DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb'

const dynamo = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME ?? 'butler-assistant'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? ''

interface GoogleTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
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

  const tokens: GoogleTokens = {
    accessToken: result.Item.accessToken?.S ?? '',
    refreshToken: result.Item.refreshToken?.S ?? '',
    expiresAt: Number(result.Item.expiresAt?.N ?? '0'),
  }

  // トークンが期限切れの場合はリフレッシュ
  const now = Date.now()
  if (tokens.expiresAt < now - 60_000) {
    if (!tokens.refreshToken) {
      return null
    }

    const refreshed = await refreshGoogleTokens(tokens.refreshToken)
    if (!refreshed) {
      return null
    }

    const updatedTokens: GoogleTokens = {
      accessToken: refreshed.access_token,
      refreshToken: tokens.refreshToken,
      expiresAt: now + refreshed.expires_in * 1000,
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
async function refreshGoogleTokens(refreshToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
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
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!res.ok) {
    const errorBody = await res.text()
    throw new Error(`トークン交換に失敗しました: ${errorBody}`)
  }

  return await res.json() as { access_token: string; refresh_token: string; expires_in: number }
}
