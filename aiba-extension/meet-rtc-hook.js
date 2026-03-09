/**
 * Ai-Ba Tools — Google Meet RTC データチャネル傍受
 *
 * ページコンテキストで実行（content script から inject）。
 * RTCPeerConnection をフックして、字幕データを
 * WebRTC データチャネルから直接取得する。
 *
 * DOM 構造には一切依存しない。
 */
;(function () {
  'use strict'

  if (window.__aibaRtcHookInstalled) return
  window.__aibaRtcHookInstalled = true

  const LOG = (...args) => console.log('[Ai-Ba RTC]', ...args)

  const OrigRTC = window.RTCPeerConnection
  if (!OrigRTC) {
    LOG('RTCPeerConnection が見つかりません')
    return
  }

  // ──────────────────────────────────────────
  // 最小限の Protobuf デコーダー
  // ──────────────────────────────────────────

  function decodeVarint(buf, pos) {
    let result = 0
    let shift = 0
    while (pos < buf.length) {
      const b = buf[pos++]
      result |= (b & 0x7f) << shift
      if ((b & 0x80) === 0) return [result, pos]
      shift += 7
      if (shift > 35) break // 安全装置
    }
    return [result, pos]
  }

  /**
   * Protobuf バイナリから全フィールドをデコードする。
   * 戻り値: { fieldNumber: value, ... }
   * value は varint(number) / length-delimited(Uint8Array) のいずれか。
   */
  function decodeFields(buf) {
    const fields = {}
    let pos = 0
    const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf)

    while (pos < view.length) {
      let tag, newPos
      try {
        ;[tag, newPos] = decodeVarint(view, pos)
      } catch { break }
      if (newPos === pos) break
      pos = newPos

      const fieldNumber = tag >>> 3
      const wireType = tag & 7

      if (fieldNumber === 0) break // 不正

      if (wireType === 0) {
        // varint
        const [value, np] = decodeVarint(view, pos)
        pos = np
        fields[fieldNumber] = value
      } else if (wireType === 2) {
        // length-delimited (string / bytes / embedded message)
        const [length, np] = decodeVarint(view, pos)
        pos = np
        if (pos + length > view.length) break
        fields[fieldNumber] = view.slice(pos, pos + length)
        pos += length
      } else if (wireType === 1) {
        // 64-bit
        pos += 8
      } else if (wireType === 5) {
        // 32-bit
        pos += 4
      } else {
        break // unknown
      }
    }
    return fields
  }

  /**
   * Uint8Array を UTF-8 文字列にデコード。
   * 有効な文字列でなければ null を返す。
   */
  function tryDecodeString(data) {
    if (!(data instanceof Uint8Array)) return null
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(data)
      return text
    } catch {
      return null
    }
  }

  // ──────────────────────────────────────────
  // BTranscriptMessage のパース
  //
  // 構造（Tactiq 解析より）:
  //   field 1: deviceId (string) — 話者の端末 ID
  //   field 2: messageId (int64)
  //   field 3: messageVersion (int64) — テキスト更新ごとに増加
  //   field 4: text (string) — 字幕テキスト
  //   field 5: langId (int64)
  // ──────────────────────────────────────────

  function parseTranscriptMessage(data) {
    const fields = decodeFields(data)

    // field 4 (text) が文字列でなければ字幕メッセージではない
    const textData = fields[4]
    if (!textData) return null

    const text = tryDecodeString(textData)
    if (!text || text.length < 1) return null

    const deviceId = fields[1] ? tryDecodeString(fields[1]) : null
    const messageId = fields[2] || 0
    const messageVersion = fields[3] || 0
    const langId = fields[5] || 0

    return { deviceId, messageId, messageVersion, text, langId }
  }

  // ──────────────────────────────────────────
  // データチャネルメッセージの処理
  //
  // "collections" チャネルにはラッパーメッセージが来る。
  // 再帰的に length-delimited フィールドをたどって
  // BTranscriptMessage を探す。
  // ──────────────────────────────────────────

  function processChannelMessage(data) {
    try {
      const buf = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer || data)
      return findTranscripts(buf, 0)
    } catch (e) {
      return []
    }
  }

  /**
   * Protobuf メッセージを再帰的に探索して字幕テキストを抽出する。
   * depth は無限再帰防止用。
   */
  function findTranscripts(buf, depth) {
    if (depth > 5) return []
    const results = []

    const fields = decodeFields(buf)

    // まず直接 BTranscriptMessage として解析を試みる
    const direct = parseTranscriptMessage(buf)
    if (direct && direct.text) {
      results.push(direct)
      return results
    }

    // 各 length-delimited フィールドを再帰的に探索
    for (const key of Object.keys(fields)) {
      const value = fields[key]
      if (value instanceof Uint8Array && value.length > 5) {
        const nested = findTranscripts(value, depth + 1)
        results.push(...nested)
      }
    }

    return results
  }

  // ──────────────────────────────────────────
  // メッセージの重複排除とディスパッチ
  // ──────────────────────────────────────────

  /** messageId + messageVersion で重複管理 */
  const seenMessages = new Map()

  function dispatchTranscript(transcript) {
    const key = `${transcript.deviceId || ''}:${transcript.messageId}`
    const prev = seenMessages.get(key)

    // 同じメッセージの古いバージョンはスキップ
    if (prev && prev >= transcript.messageVersion) return

    seenMessages.set(key, transcript.messageVersion)

    // 古いエントリをクリーンアップ（1000件超えたら）
    if (seenMessages.size > 1000) {
      const keys = [...seenMessages.keys()]
      for (let i = 0; i < 500; i++) {
        seenMessages.delete(keys[i])
      }
    }

    // ページ → content script への転送
    window.postMessage({
      type: 'aiba-rtc-caption',
      deviceId: transcript.deviceId,
      messageId: transcript.messageId,
      messageVersion: transcript.messageVersion,
      text: transcript.text,
      langId: transcript.langId,
    }, '*')
  }

  // ──────────────────────────────────────────
  // RTCPeerConnection のフック
  // ──────────────────────────────────────────

  function hookDataChannel(channel) {
    const label = channel.label
    LOG(`データチャネル検出: "${label}"`)

    // "collections" または "meet_messages" チャネルを監視
    if (label === 'collections' || label === 'meet_messages') {
      LOG(`★ 字幕チャネル "${label}" を傍受開始`)

      channel.addEventListener('message', (event) => {
        const transcripts = processChannelMessage(event.data)
        for (const t of transcripts) {
          if (t.text) {
            dispatchTranscript(t)
          }
        }
      })
    }
  }

  // RTCPeerConnection を置き換え
  window.RTCPeerConnection = function (config, constraints) {
    const pc = new OrigRTC(config, constraints)

    // 受信データチャネルを傍受
    pc.addEventListener('datachannel', (event) => {
      hookDataChannel(event.channel)
    })

    return pc
  }
  window.RTCPeerConnection.prototype = OrigRTC.prototype
  // 静的プロパティをコピー
  Object.keys(OrigRTC).forEach((key) => {
    try { window.RTCPeerConnection[key] = OrigRTC[key] } catch {}
  })

  // 既存の createDataChannel もフック（自分で作成したチャネルも傍受）
  const origCreateDC = OrigRTC.prototype.createDataChannel
  OrigRTC.prototype.createDataChannel = function () {
    const channel = origCreateDC.apply(this, arguments)
    if (channel) {
      hookDataChannel(channel)
    }
    return channel
  }

  LOG('RTCPeerConnection フック完了')
})()
