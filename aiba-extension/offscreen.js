/**
 * Ai-Ba Tools — Offscreen Document
 *
 * tabCapture のタブ音声を Amazon Transcribe Streaming WebSocket で文字起こしする。
 *
 * フロー:
 * 1. background.js から streamId を受け取る
 * 2. getUserMedia でタブ音声ストリームを取得
 * 3. AudioContext (16kHz) で PCM に変換
 * 4. Lambda から Transcribe presigned URL を取得
 * 5. WebSocket で Transcribe に PCM を送信
 * 6. 認識結果を background → content script に転送
 */
'use strict'

const LOG = (...args) => console.log('[Ai-Ba Offscreen]', ...args)

// ── 設定 ──
// Lambda Function URL (デプロイ後に設定)
const TRANSCRIBE_URL_ENDPOINT = 'https://q7luwchygdycfwpv35cfv7zw5e0wlxrd.lambda-url.ap-northeast-1.on.aws/'

let mediaStream = null
let audioContext = null
let processor = null
let ws = null
let isCapturing = false

// Service Worker との Port 接続（メッセージ通信用）
const port = chrome.runtime.connect({ name: 'offscreen-keepalive' })
LOG('Port 接続完了')

// background → offscreen のメッセージ受信（Port 経由）
port.onMessage.addListener((message) => {
  LOG('Port メッセージ受信:', message.type)
  if (message.type === 'offscreen-start-capture') {
    startCapture(message.streamId)
  }
  if (message.type === 'offscreen-stop-capture') {
    stopCapture()
  }
})

// offscreen → background へ送信するヘルパー
function sendToBackground(message) {
  try {
    port.postMessage(message)
  } catch (e) {
    LOG('Port 送信エラー:', e.message)
  }
}

// ══════════════════════════════════════════
// タブ音声キャプチャ + Transcribe
// ══════════════════════════════════════════
async function startCapture(streamId) {
  if (isCapturing) {
    LOG('既にキャプチャ中、再起動')
    stopCapture()
  }

  try {
    // タブ音声ストリーム取得
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
    })
    LOG('タブ音声ストリーム取得成功')
    isCapturing = true

    // Transcribe に接続
    if (TRANSCRIBE_URL_ENDPOINT) {
      await connectTranscribe()
    } else {
      LOG('Transcribe URL 未設定 — テストモード（音声レベル監視のみ）')
    }

    // PCM 変換開始
    startAudioProcessing()

    sendToBackground({
      type: 'tab-capture-status',
      status: 'active',
    })
  } catch (err) {
    LOG('タブ音声取得エラー:', err)
    sendToBackground({
      type: 'tab-capture-status',
      status: 'error',
      error: err.message,
    })
  }
}

function startAudioProcessing() {
  // 16kHz モノラルで AudioContext を作成
  audioContext = new AudioContext({ sampleRate: 16000 })
  const source = audioContext.createMediaStreamSource(mediaStream)

  // ScriptProcessorNode で PCM データを取得（4096 サンプル = 256ms @ 16kHz）
  processor = audioContext.createScriptProcessor(4096, 1, 1)

  let audioLevel = 0
  let lastLevelLog = 0

  processor.onaudioprocess = (e) => {
    if (!isCapturing) return
    const float32 = e.inputBuffer.getChannelData(0)

    // 音声レベル計算（デバッグ用）
    let sum = 0
    for (let i = 0; i < float32.length; i++) {
      sum += float32[i] * float32[i]
    }
    audioLevel = Math.sqrt(sum / float32.length)

    const now = Date.now()
    if (now - lastLevelLog > 3000) {
      LOG(`音声レベル: ${(audioLevel * 100).toFixed(2)}%`)
      lastLevelLog = now
    }

    // Transcribe に送信
    if (ws && ws.readyState === WebSocket.OPEN) {
      const pcm16 = float32ToInt16(float32)
      sendAudioEvent(pcm16)
    }
  }

  source.connect(processor)
  // ScriptProcessorNode は destination に接続しないと動作しない
  processor.connect(audioContext.destination)
  LOG('PCM 音声処理開始 (16kHz mono)')
}

async function connectTranscribe() {
  LOG('Transcribe presigned URL を取得中...', TRANSCRIBE_URL_ENDPOINT)

  try {
    const res = await fetch(TRANSCRIBE_URL_ENDPOINT)
    LOG('Lambda レスポンス status:', res.status)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const presignedUrl = data.url
    LOG('Presigned URL 取得成功, length:', presignedUrl?.length)

    if (!presignedUrl) throw new Error('presigned URL が空です')

    LOG('Transcribe WebSocket 接続中...')
    ws = new WebSocket(presignedUrl)
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      LOG('Transcribe WebSocket 接続成功!')
    }

    ws.onmessage = (event) => {
      try {
        const message = decodeEventStreamMessage(event.data)
        if (message.headers[':message-type'] === 'event') {
          const eventType = message.headers[':event-type']
          if (eventType === 'TranscriptEvent') {
            const json = JSON.parse(new TextDecoder().decode(message.payload))
            handleTranscriptEvent(json)
          }
        } else if (message.headers[':message-type'] === 'exception') {
          const errorMsg = new TextDecoder().decode(message.payload)
          LOG('Transcribe 例外:', errorMsg)
        }
      } catch (err) {
        LOG('メッセージ解析エラー:', err)
      }
    }

    ws.onerror = (err) => {
      LOG('WebSocket エラー:', err)
      sendToBackground({
        type: 'tab-capture-status',
        status: 'error',
        error: 'Transcribe WebSocket 接続エラー',
      })
    }

    ws.onclose = (event) => {
      LOG(`WebSocket 切断: code=${event.code} reason=${event.reason}`)
      // よくあるエラーコードの説明
      if (event.code === 1006) {
        LOG('異常切断 — presigned URL の署名が無効か期限切れの可能性')
      }
      ws = null
    }
  } catch (err) {
    LOG('Transcribe 接続エラー:', err)
    sendToBackground({
      type: 'tab-capture-status',
      status: 'error',
      error: `Transcribe 接続失敗: ${err.message}`,
    })
  }
}

function handleTranscriptEvent(json) {
  const results = json?.Transcript?.Results
  if (!results || results.length === 0) return

  for (const result of results) {
    const alt = result.Alternatives?.[0]
    if (!alt) continue
    const text = alt.Transcript?.trim()
    if (!text) continue

    sendToBackground({
      type: 'tab-transcript',
      text,
      isFinal: !result.IsPartial,
      timestamp: Date.now(),
      source: 'tab-audio',
    })
  }
}

function stopCapture() {
  LOG('キャプチャ停止')
  isCapturing = false

  // MediaStream を最優先で停止（タブキャプチャの解放）
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => {
      t.stop()
      LOG('トラック停止:', t.kind, t.label)
    })
    mediaStream = null
  }

  // WebSocket 切断
  if (ws) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        sendAudioEvent(new Uint8Array(0))
      }
      ws.close()
    } catch (e) { /* ignore */ }
    ws = null
  }

  // AudioContext 停止
  if (processor) {
    processor.disconnect()
    processor = null
  }
  if (audioContext) {
    audioContext.close().catch(() => {})
    audioContext = null
  }

  sendToBackground({
    type: 'tab-capture-status',
    status: 'stopped',
  })
}

// ══════════════════════════════════════════
// PCM 変換
// ══════════════════════════════════════════
function float32ToInt16(float32) {
  const int16 = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
  }
  return new Uint8Array(int16.buffer)
}

// ══════════════════════════════════════════
// AWS Event Stream エンコード/デコード
// ══════════════════════════════════════════

// CRC32C (Castagnoli) テーブル
const CRC32C_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let crc = i
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? (0x82F63B78 ^ (crc >>> 1)) : (crc >>> 1)
    }
    table[i] = crc
  }
  return table
})()

function crc32c(data) {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) {
    crc = CRC32C_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function encodeEventStreamMessage(headers, payload) {
  // ヘッダーをバイナリにエンコード
  const headerChunks = []
  let headersLength = 0

  for (const [name, value] of Object.entries(headers)) {
    const nameBytes = new TextEncoder().encode(name)
    const valueBytes = new TextEncoder().encode(value)
    const chunk = new Uint8Array(1 + nameBytes.length + 1 + 2 + valueBytes.length)
    const view = new DataView(chunk.buffer)
    let offset = 0

    chunk[offset++] = nameBytes.length
    chunk.set(nameBytes, offset); offset += nameBytes.length
    chunk[offset++] = 7 // string type
    view.setUint16(offset, valueBytes.length); offset += 2
    chunk.set(valueBytes, offset)

    headerChunks.push(chunk)
    headersLength += chunk.length
  }

  // メッセージ組み立て
  const totalLength = 12 + headersLength + payload.length + 4
  const message = new Uint8Array(totalLength)
  const view = new DataView(message.buffer)

  // プレリュード
  view.setUint32(0, totalLength)
  view.setUint32(4, headersLength)
  view.setUint32(8, crc32c(new Uint8Array(message.buffer, 0, 8)))

  // ヘッダー
  let offset = 12
  for (const chunk of headerChunks) {
    message.set(chunk, offset)
    offset += chunk.length
  }

  // ペイロード
  message.set(payload, offset)
  offset += payload.length

  // メッセージ CRC
  view.setUint32(offset, crc32c(new Uint8Array(message.buffer, 0, offset)))

  return message
}

function decodeEventStreamMessage(buffer) {
  const data = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const totalLength = view.getUint32(0)
  const headersLength = view.getUint32(4)

  // ヘッダー解析
  const headers = {}
  let offset = 12
  const headersEnd = 12 + headersLength

  while (offset < headersEnd) {
    const nameLen = data[offset++]
    const name = new TextDecoder().decode(data.slice(offset, offset + nameLen))
    offset += nameLen
    const valueType = data[offset++]

    if (valueType === 7) { // string
      const valueLen = view.getUint16(offset); offset += 2
      const value = new TextDecoder().decode(data.slice(offset, offset + valueLen))
      offset += valueLen
      headers[name] = value
    } else {
      // 他の型はスキップ（PoC では string のみ対応）
      break
    }
  }

  // ペイロード
  const payloadLength = totalLength - 12 - headersLength - 4
  const payload = data.slice(12 + headersLength, 12 + headersLength + payloadLength)

  return { headers, payload }
}

function sendAudioEvent(pcmData) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return

  const message = encodeEventStreamMessage(
    {
      ':content-type': 'application/octet-stream',
      ':event-type': 'AudioEvent',
      ':message-type': 'event',
    },
    pcmData,
  )
  ws.send(message.buffer)
}
