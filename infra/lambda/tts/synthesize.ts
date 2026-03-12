import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const polly = new PollyClient({})

const AIVIS_API_KEY = process.env.AIVIS_API_KEY ?? ''
const AIVIS_DEFAULT_MODEL_UUID = process.env.AIVIS_MODEL_UUID ?? ''

/**
 * POST /tts/synthesize — 音声合成（Polly / Aivis 切替対応）
 *
 * body.provider で切替: 'aivis' | デフォルト(Polly)
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub
  if (!userId) {
    return response(401, { error: 'Unauthorized' })
  }

  if (!event.body) {
    return response(400, { error: 'Request body is required' })
  }

  let text: string
  let provider: string

  try {
    const body = JSON.parse(event.body)
    text = body.text
    provider = typeof body.provider === 'string' ? body.provider : 'polly'

    if (!text || typeof text !== 'string') {
      return response(400, { error: 'text is required' })
    }

    // Aivis ルート
    if (provider === 'aivis') {
      return await synthesizeAivis(text, body)
    }

    // Polly ルート（デフォルト）
    return await synthesizePolly(text, body)
  } catch {
    return response(400, { error: 'Invalid JSON' })
  }
}

/**
 * Amazon Polly で音声合成
 */
async function synthesizePolly(text: string, body: { voiceId?: string; engine?: string }): Promise<APIGatewayProxyResult> {
  const voiceId = body.voiceId ?? 'Kazuha'
  const engine = body.engine ?? 'neural'

  try {
    const result = await polly.send(new SynthesizeSpeechCommand({
      Text: text,
      VoiceId: voiceId,
      Engine: engine,
      OutputFormat: 'mp3',
      LanguageCode: 'ja-JP',
    }))

    if (!result.AudioStream) {
      return response(500, { error: 'No audio stream returned' })
    }

    const chunks: Uint8Array[] = []
    for await (const chunk of result.AudioStream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk)
    }
    const buffer = Buffer.concat(chunks)
    const audio = buffer.toString('base64')

    return response(200, { audio })
  } catch (error) {
    console.error('[TTS/Polly] 音声合成エラー:', error)
    return response(500, { error: 'Speech synthesis failed' })
  }
}

/**
 * Aivis Cloud API で音声合成
 */
async function synthesizeAivis(text: string, body: { modelUuid?: string; speakingRate?: number; pitch?: number }): Promise<APIGatewayProxyResult> {
  if (!AIVIS_API_KEY) {
    return response(500, { error: 'Aivis API key not configured' })
  }

  // テキスト長制限（コスト対策: 1リクエストあたり最大1000文字）
  if (text.length > 1000) {
    return response(400, { error: 'text must be 1000 characters or less' })
  }

  const modelUuid = typeof body.modelUuid === 'string' ? body.modelUuid : AIVIS_DEFAULT_MODEL_UUID
  if (!modelUuid) {
    return response(500, { error: 'Aivis model UUID not configured' })
  }

  const speakingRate = typeof body.speakingRate === 'number' ? Math.max(0.5, Math.min(2, body.speakingRate)) : 1
  const pitch = typeof body.pitch === 'number' ? Math.max(-1, Math.min(1, body.pitch)) : 0

  try {
    const res = await fetch('https://api.aivis-project.com/v1/tts/synthesize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AIVIS_API_KEY}`,
      },
      body: JSON.stringify({
        model_uuid: modelUuid,
        text,
        output_format: 'mp3',
        speaking_rate: speakingRate,
        pitch,
      }),
    })

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error')
      console.error('[TTS/Aivis] API エラー:', res.status, errorText)
      return response(res.status === 429 ? 429 : 500, {
        error: `Aivis API error: ${res.status}`,
      })
    }

    // Aivis は blob（バイナリ）を返すので base64 に変換
    const arrayBuffer = await res.arrayBuffer()
    const audio = Buffer.from(arrayBuffer).toString('base64')

    return response(200, { audio, format: 'mp3' })
  } catch (error) {
    console.error('[TTS/Aivis] 音声合成エラー:', error)
    return response(500, { error: 'Speech synthesis failed' })
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
