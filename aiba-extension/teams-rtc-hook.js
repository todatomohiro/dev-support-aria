/**
 * Ai-Ba Tools — MS Teams RTC データチャネル傍受
 *
 * ページコンテキストで実行（content script から inject）。
 * RTCPeerConnection.createDataChannel をフックし、
 * "main-channel" から字幕データ（recognitionResults）を取得する。
 *
 * Teams の字幕データ形式:
 *   Binary Uint8Array → TextDecoder → JSON
 *   { recognitionResults: [{ text, userId, timestampAudioSent, ... }] }
 */
;(function () {
  'use strict'

  if (window.__aibaTeamsRtcHookInstalled) return
  window.__aibaTeamsRtcHookInstalled = true

  const LOG = (...args) => console.log('[Ai-Ba Teams RTC]', ...args)

  const OrigRTC = window.RTCPeerConnection
  if (!OrigRTC) {
    LOG('RTCPeerConnection が見つかりません')
    return
  }

  // ──────────────────────────────────────────
  // 参加者名のマッピング
  // ──────────────────────────────────────────
  const participantNames = new Map()

  // Teams の通話オブジェクトから参加者リストを取得する試み
  function updateParticipants() {
    try {
      // Teams の内部 API にアクセスできる場合
      if (window._clientService?.callingService) {
        const calls = window._clientService.callingService.getCalls?.()
        if (calls) {
          for (const call of Object.values(calls)) {
            const participants = call.participants || call.remoteParticipants
            if (participants) {
              for (const p of Object.values(participants)) {
                const id = p.userId || p.mri
                const name = p.displayName || p.name
                if (id && name) {
                  participantNames.set(id, name)
                }
              }
            }
          }
        }
      }
    } catch {
      // 内部 API アクセス不可
    }
  }

  // ──────────────────────────────────────────
  // データチャネルメッセージの処理
  // ──────────────────────────────────────────
  function processMessage(data) {
    try {
      let text
      if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
        const buf = data instanceof Uint8Array ? data : new Uint8Array(data)
        text = new TextDecoder('utf-8', { fatal: false }).decode(buf)
      } else if (typeof data === 'string') {
        text = data
      } else {
        return
      }

      // JSON として解析
      // Teams のメッセージは複数形式がある。字幕は recognitionResults を含む。
      let json
      try {
        json = JSON.parse(text)
      } catch {
        // JSON でない場合はスキップ
        return
      }

      // recognitionResults があれば字幕データ
      const results = json.recognitionResults || json.results
      if (!results || !Array.isArray(results)) return

      for (const result of results) {
        const captionText = result.text || result.caption || result.transcript
        if (!captionText || captionText.trim().length === 0) continue

        const userId = result.userId || result.participantId || result.speakerId || ''
        const timestamp = result.timestampAudioSent || result.timestamp || Date.now()

        // 参加者名の解決
        updateParticipants()
        const speaker = participantNames.get(userId) || ''

        window.postMessage({
          type: 'aiba-teams-caption',
          text: captionText.trim(),
          userId,
          speaker,
          timestamp,
          isFinal: result.isFinal !== false, // デフォルト true
        }, '*')
      }
    } catch (e) {
      // パースエラーは無視
    }
  }

  // ──────────────────────────────────────────
  // RTCPeerConnection のフック
  // ──────────────────────────────────────────
  const origCreateDC = OrigRTC.prototype.createDataChannel
  OrigRTC.prototype.createDataChannel = function () {
    const channel = origCreateDC.apply(this, arguments)
    if (channel) {
      LOG(`createDataChannel: "${channel.label}"`)

      if (channel.label === 'main-channel') {
        LOG('★ Teams 字幕チャネル "main-channel" を傍受')
        channel.addEventListener('message', (event) => {
          processMessage(event.data)
        })
      }
    }
    return channel
  }

  // 受信チャネルも傍受
  const origAddEventListener = OrigRTC.prototype.addEventListener
  if (origAddEventListener) {
    // datachannel イベントリスナーが追加された時にフック
    const origOnDataChannel = Object.getOwnPropertyDescriptor(OrigRTC.prototype, 'ondatachannel')
    if (origOnDataChannel) {
      Object.defineProperty(OrigRTC.prototype, 'ondatachannel', {
        set(fn) {
          origOnDataChannel.set.call(this, function (event) {
            if (event.channel.label === 'main-channel') {
              LOG('★ Teams 受信チャネル "main-channel" を傍受')
              event.channel.addEventListener('message', (msgEvent) => {
                processMessage(msgEvent.data)
              })
            }
            if (fn) fn.call(this, event)
          })
        },
        get() {
          return origOnDataChannel.get.call(this)
        },
      })
    }
  }

  // addEventListener('datachannel') もフック
  const origAEL = OrigRTC.prototype.addEventListener
  OrigRTC.prototype.addEventListener = function (type, listener, options) {
    if (type === 'datachannel') {
      const wrappedListener = function (event) {
        if (event.channel && event.channel.label === 'main-channel') {
          LOG('★ Teams addEventListener チャネル傍受')
          event.channel.addEventListener('message', (msgEvent) => {
            processMessage(msgEvent.data)
          })
        }
        return listener.call(this, event)
      }
      return origAEL.call(this, type, wrappedListener, options)
    }
    return origAEL.call(this, type, listener, options)
  }

  LOG('Teams RTCPeerConnection フック完了')
})()
