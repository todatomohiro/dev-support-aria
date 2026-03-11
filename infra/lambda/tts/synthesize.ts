import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const polly = new PollyClient({})

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? ''
/** ElevenLabs デフォルトボイスID（Aria — 多言語対応の女性ボイス） */
const ELEVENLABS_DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'
/** ElevenLabs デフォルトモデル（多言語 v2 — 日本語対応） */
const ELEVENLABS_DEFAULT_MODEL_ID = 'eleven_multilingual_v2'

/**
 * POST /tts/synthesize — 音声合成（Polly / ElevenLabs 切替対応）
 *
 * body.provider === 'elevenlabs' の場合は ElevenLabs API、それ以外は Polly を使用。
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

    // ElevenLabs ルート
    if (provider === 'elevenlabs') {
      return await synthesizeElevenLabs(text, body)
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
 * ElevenLabs で音声合成
 */
async function synthesizeElevenLabs(text: string, body: { voiceId?: string; modelId?: string; speed?: number }): Promise<APIGatewayProxyResult> {
  if (!ELEVENLABS_API_KEY) {
    return response(500, { error: 'ElevenLabs API key not configured' })
  }

  // テキスト長制限（コスト対策: 1リクエストあたり最大1000文字）
  if (text.length > 1000) {
    return response(400, { error: 'text must be 1000 characters or less' })
  }

  const voiceId = typeof body.voiceId === 'string' ? body.voiceId : ELEVENLABS_DEFAULT_VOICE_ID
  const modelId = typeof body.modelId === 'string' ? body.modelId : ELEVENLABS_DEFAULT_MODEL_ID
  const speed = typeof body.speed === 'number' ? Math.max(0.5, Math.min(2, body.speed)) : 1

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          language_code: 'ja',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0,
            speed,
            use_speaker_boost: true,
          },
        }),
      }
    )

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error')
      console.error('[TTS/ElevenLabs] API エラー:', res.status, errorText)
      return response(res.status === 429 ? 429 : 500, {
        error: `ElevenLabs API error: ${res.status}`,
      })
    }

    const arrayBuffer = await res.arrayBuffer()
    const audio = Buffer.from(arrayBuffer).toString('base64')

    return response(200, { audio, format: 'mp3' })
  } catch (error) {
    console.error('[TTS/ElevenLabs] 音声合成エラー:', error)
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
