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
  // 字幕メッセージのパース
  //
  // captions チャネルの構造（実データ解析 2026-03-09）:
  //   field 1: outer message（1件の字幕エントリ）
  //     field 1: deviceId (string) — "spaces/xxx/devices/500"
  //     field 2: participantId (varint)
  //     field 3: sequenceNumber (varint) — 増加する
  //     field 6: text (string) — 字幕テキスト ★
  //     field 8: langId (varint) — 9=ja?
  //     field 12: startTimestamp (nested)
  //     field 13: endTimestamp (nested)
  //
  // collections チャネル（旧 Tactiq 方式）:
  //   field 1: deviceId, field 4: text
  // ──────────────────────────────────────────

  function parseTranscriptMessage(data) {
    const fields = decodeFields(data)

    // パターン1: captions チャネル — テキストは field 6
    const textField6 = fields[6]
    if (textField6) {
      const text = tryDecodeString(textField6)
      if (text && text.length >= 1) {
        const deviceId = fields[1] ? tryDecodeString(fields[1]) : null
        const messageId = fields[2] || 0
        const messageVersion = fields[3] || 0
        const langId = fields[8] || 0
        return { deviceId, messageId, messageVersion, text, langId }
      }
    }

    // パターン2: collections チャネル（旧形式）— テキストは field 4
    const textField4 = fields[4]
    if (textField4) {
      const text = tryDecodeString(textField4)
      if (text && text.length >= 1) {
        const deviceId = fields[1] ? tryDecodeString(fields[1]) : null
        const messageId = fields[2] || 0
        const messageVersion = fields[3] || 0
        const langId = fields[5] || 0
        return { deviceId, messageId, messageVersion, text, langId }
      }
    }

    return null
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
  // gzip 解凍
  // ──────────────────────────────────────────

  /**
   * gzip 圧縮データを解凍する（DecompressionStream API 使用）。
   * ブラウザネイティブ API なので追加ライブラリ不要。
   */
  async function gunzip(data) {
    const ds = new DecompressionStream('gzip')
    const writer = ds.writable.getWriter()
    writer.write(data)
    writer.close()
    const reader = ds.readable.getReader()
    const chunks = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    return result
  }

  /**
   * データが gzip 圧縮されているか判定（マジックナンバー 1f 8b）。
   */
  function isGzip(buf) {
    return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b
  }

  // ──────────────────────────────────────────
  // collections チャネルからデバイス名を抽出
  //
  // Protobuf 構造（Tactiq 解析に基づく）:
  //   BDevice: field1 → Sub1: field2 → Sub2: field2 → Sub3: field2 → Sub4: field1 → Sub5
  //     Sub5: field1 = deviceId (string), field2 = deviceName (string)
  //
  //   BMeetingCollection: field2 → Sub1: field2 → Sub2: field2[] → Sub5[]
  //     Sub5: field1 = deviceId, field2 = deviceName
  // ──────────────────────────────────────────

  /**
   * collections チャネルのメッセージから deviceId → deviceName マッピングを抽出する。
   * BDevice 形式（単一）: field1.field2.field13.field1.field2 → Sub5 { deviceId, deviceName }
   */
  function parseDeviceInfo(buf) {
    try {
      // BDevice: field1 → Sub1: field2 → Sub2: field13 → Sub3: field1 → Sub4: field2 → Sub5
      const l1 = decodeFields(buf)
      if (!l1[1] || !(l1[1] instanceof Uint8Array)) return null
      const l2 = decodeFields(l1[1])
      if (!l2[2] || !(l2[2] instanceof Uint8Array)) return null
      const l3 = decodeFields(l2[2])
      if (!l3[13] || !(l3[13] instanceof Uint8Array)) return null
      const sub3 = decodeFields(l3[13])
      if (!sub3[1] || !(sub3[1] instanceof Uint8Array)) return null
      const sub4 = decodeFields(sub3[1])
      if (!sub4[2] || !(sub4[2] instanceof Uint8Array)) return null
      const sub5 = decodeFields(sub4[2])

      const deviceId = sub5[1] ? tryDecodeString(sub5[1]) : null
      const deviceName = sub5[2] ? tryDecodeString(sub5[2]) : null
      if (deviceId && deviceName) {
        return { deviceId, deviceName }
      }
    } catch {}
    return null
  }

  /**
   * collections チャネルの BMeetingCollection 形式から参加者リストを抽出する。
   * field2.field2.field2[] → [{ deviceId, deviceName }, ...]
   */
  function parseMeetingCollection(buf) {
    try {
      const root = decodeFields(buf)
      if (!root[2] || !(root[2] instanceof Uint8Array)) return null
      const sub1 = decodeFields(root[2])
      if (!sub1[2] || !(sub1[2] instanceof Uint8Array)) return null

      // sub2 の field2 は repeated（配列）なので全エントリを走査
      const results = []
      const sub2Buf = sub1[2]
      let pos = 0
      while (pos < sub2Buf.length) {
        let tag, newPos
        try {
          ;[tag, newPos] = decodeVarint(sub2Buf, pos)
        } catch { break }
        if (newPos === pos) break
        pos = newPos
        const wireType = tag & 7
        if (wireType === 2) {
          const [len, np] = decodeVarint(sub2Buf, pos)
          pos = np
          if (pos + len > sub2Buf.length) break
          const entry = sub2Buf.slice(pos, pos + len)
          pos += len
          const fields = decodeFields(entry)
          const deviceId = fields[1] ? tryDecodeString(fields[1]) : null
          const deviceName = fields[2] ? tryDecodeString(fields[2]) : null
          if (deviceId && deviceName) {
            results.push({ deviceId, deviceName })
          }
        } else if (wireType === 0) {
          decodeVarint(sub2Buf, pos)
          pos = newPos
        } else {
          break
        }
      }
      return results.length > 0 ? results : null
    } catch {}
    return null
  }

  /**
   * collections メッセージからデバイス情報を抽出して dispatch する。
   */
  function processDeviceInfo(data) {
    const buf = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer || data)

    // BDevice 形式（単一デバイス）
    const single = parseDeviceInfo(buf)
    if (single) {
      dispatchDeviceInfo(single.deviceId, single.deviceName)
      return
    }

    // BMeetingCollection 形式（複数デバイス）
    const list = parseMeetingCollection(buf)
    if (list) {
      for (const item of list) {
        dispatchDeviceInfo(item.deviceId, item.deviceName)
      }
    }
  }

  function dispatchDeviceInfo(deviceId, deviceName) {
    LOG(`★ デバイス情報: ${deviceId} → "${deviceName}"`)
    window.postMessage({
      type: 'aiba-rtc-deviceinfo',
      deviceId,
      deviceName,
    }, '*')
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

    // deviceId パターン（spaces/xxx/devices/nnn）をテキストとして誤検出した場合はスキップ
    if (/^spaces\/[^\s]+\/devices\/\d+$/.test(transcript.text)) return

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

    // collections チャネル: デバイス名マッピング + 字幕
    if (label === 'collections') {
      LOG(`★ チャネル "${label}" を傍受開始（デバイス情報 + 字幕）`)

      let msgCount = 0
      channel.addEventListener('message', async (event) => {
        msgCount++
        const data = event.data

        try {
          let buf = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer || data)

          // gzip 解凍
          if (isGzip(buf)) {
            buf = await gunzip(buf)
          }

          // デバイス情報を抽出（deviceId → deviceName マッピング）
          processDeviceInfo(buf)

          // 字幕テキストも探す（旧形式の collections 字幕対応）
          const transcripts = processChannelMessage(buf)
          for (const t of transcripts) {
            if (t.text) dispatchTranscript(t)
          }
        } catch (e) {
          if (msgCount <= 5) LOG(`[${label}] 処理エラー:`, e.message)
        }
      })
      return
    }

    // captions チャネル: 字幕テキスト
    if (label === 'captions') {
      LOG(`★ チャネル "${label}" を傍受開始（字幕）`)

      channel.addEventListener('message', (event) => {
        const transcripts = processChannelMessage(event.data)
        for (const t of transcripts) {
          if (t.text) dispatchTranscript(t)
        }
      })
    }
  }

  // RTCPeerConnection を置き換え
  let pcCount = 0
  window.RTCPeerConnection = function (config, constraints) {
    pcCount++
    LOG(`★ new RTCPeerConnection #${pcCount}`)
    const pc = new OrigRTC(config, constraints)

    // 受信データチャネルを傍受
    pc.addEventListener('datachannel', (event) => {
      hookDataChannel(event.channel)
    })

    // 接続状態のログ
    pc.addEventListener('connectionstatechange', () => {
      LOG(`PC #${pcCount} 状態: ${pc.connectionState}`)
    })

    return pc
  }
  window.RTCPeerConnection.prototype = OrigRTC.prototype
  // 静的プロパティをコピー
  Object.keys(OrigRTC).forEach((key) => {
    try { window.RTCPeerConnection[key] = OrigRTC[key] } catch {}
  })
  // webkitRTCPeerConnection もフック（一部ブラウザ互換）
  if (window.webkitRTCPeerConnection) {
    window.webkitRTCPeerConnection = window.RTCPeerConnection
  }

  // 既存の createDataChannel もフック（自分で作成したチャネルも傍受）
  const origCreateDC = OrigRTC.prototype.createDataChannel
  OrigRTC.prototype.createDataChannel = function () {
    const channel = origCreateDC.apply(this, arguments)
    if (channel) {
      hookDataChannel(channel)
    }
    return channel
  }

  LOG('RTCPeerConnection フック完了（world:MAIN 直接注入）')

  // ──────────────────────────────────────────
  // fetch フック: syncMeetingSpaceCollections レスポンスからデバイス情報を取得
  // ──────────────────────────────────────────
  const COLLECTIONS_URL = 'https://meet.google.com/$rpc/google.rtc.meetings.v1.MeetingSpaceService/SyncMeetingSpaceCollections'
  const origFetch = window.fetch
  window.fetch = function () {
    const result = origFetch.apply(this, arguments)
    result.then((response) => {
      try {
        if (response.url === COLLECTIONS_URL) {
          response.clone().text().then((text) => {
            try {
              const bin = Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
              const devices = parseMeetingCollection(bin)
              if (devices) {
                LOG(`★ HTTP SyncMeetingSpaceCollections から ${devices.length} 件のデバイス情報取得`)
                for (const item of devices) {
                  dispatchDeviceInfo(item.deviceId, item.deviceName)
                }
              }
            } catch (e) {
              LOG('HTTP collections パースエラー:', e.message)
            }
          })
        }
      } catch {}
    }).catch(() => {})
    return result
  }
  LOG('fetch フック完了（SyncMeetingSpaceCollections 監視）')
})()
