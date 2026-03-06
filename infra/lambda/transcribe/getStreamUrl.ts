import crypto from 'crypto'
import type { APIGatewayProxyResult } from 'aws-lambda'

/**
 * Amazon Transcribe Streaming 用の Presigned WebSocket URL を生成する Lambda
 *
 * Chrome 拡張（PoC）から直接呼ばれるため、認証なし（Function URL）で提供。
 * 本番運用時は Cognito 認証を追加すること。
 */
export const handler = async (): Promise<APIGatewayProxyResult> => {
  const region = process.env.AWS_REGION || 'ap-northeast-1'
  const accessKey = process.env.AWS_ACCESS_KEY_ID!
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY!
  const sessionToken = process.env.AWS_SESSION_TOKEN

  try {
    const url = createPresignedUrl(region, accessKey, secretKey, sessionToken)
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }
  } catch (err) {
    console.error('Presigned URL 生成エラー:', err)
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to generate presigned URL' }),
    }
  }
}

function createPresignedUrl(
  region: string,
  accessKey: string,
  secretKey: string,
  sessionToken?: string,
): string {
  const host = `transcribestreaming.${region}.amazonaws.com`
  const path = '/stream-transcription-websocket'
  const now = new Date()
  const dateStamp = toDateStamp(now)
  const amzDate = toAmzDate(now)
  const credentialScope = `${dateStamp}/${region}/transcribe/aws4_request`

  const params: Record<string, string> = {
    'language-code': 'ja-JP',
    'media-encoding': 'pcm',
    'sample-rate': '16000',
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKey}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': '300',
    'X-Amz-SignedHeaders': 'host',
  }
  if (sessionToken) {
    params['X-Amz-Security-Token'] = sessionToken
  }

  // クエリ文字列（ソート済み）
  const canonicalQuerystring = Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&')

  // 正規リクエスト
  const canonicalRequest = [
    'GET',
    path,
    canonicalQuerystring,
    `host:${host}:8443\n`,
    'host',
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  ].join('\n')

  // 署名文字列
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n')

  // 署名キー
  const signingKey = getSignatureKey(secretKey, dateStamp, region, 'transcribe')
  const signature = hmac(signingKey, stringToSign).toString('hex')

  return `wss://${host}:8443${path}?${canonicalQuerystring}&X-Amz-Signature=${signature}`
}

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex')
}

function hmac(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest()
}

function getSignatureKey(key: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${key}`, dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  return hmac(kService, 'aws4_request')
}

function toDateStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').slice(0, 8)
}

function toAmzDate(d: Date): string {
  // ISO: 2026-03-06T14:10:55.123Z → 20260306T141055Z
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}
