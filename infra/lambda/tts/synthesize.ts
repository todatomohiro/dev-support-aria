import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

const polly = new PollyClient({})

/**
 * POST /tts/synthesize — Amazon Polly で音声合成
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
  let voiceId: string
  let engine: string

  try {
    const body = JSON.parse(event.body)
    text = body.text
    voiceId = body.voiceId ?? 'Kazuha'
    engine = body.engine ?? 'neural'

    if (!text || typeof text !== 'string') {
      return response(400, { error: 'text is required' })
    }
  } catch {
    return response(400, { error: 'Invalid JSON' })
  }

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

    // AudioStream を base64 エンコード
    const chunks: Uint8Array[] = []
    for await (const chunk of result.AudioStream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk)
    }
    const buffer = Buffer.concat(chunks)
    const audio = buffer.toString('base64')

    return response(200, { audio })
  } catch (error) {
    console.error('Polly 音声合成エラー:', error)
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
