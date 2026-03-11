/**
 * Ai-Ba Tools — MS Teams RTC データチャネル傍受 + 内部 API フック
 *
 * ページコンテキスト（world: "MAIN"）で実行。
 *
 * 2つの経路で字幕を取得する:
 *   経路A (V2 Calling): Teams 内部 callingService → dataChannel.subscriptions
 *                        remoteUserEventsReceived ハンドラーをフック
 *   経路B (Light Meetings / フォールバック):
 *                        RTCPeerConnection.createDataChannel → "main-channel" 傍受
 *
 * 参加者名は WebSocket フック（rosterUpdate）で取得する。
 */
;(function () {
  'use strict'

  if (window.__aibaTeamsRtcHookInstalled) return
  window.__aibaTeamsRtcHookInstalled = true

  const LOG = (...args) => console.log('[Ai-Ba Teams RTC]', ...args)

  // ──────────────────────────────────────────
  // pako (inflate) — WebSocket の gzip 圧縮ボディ展開用
  // 軽量 inflate のみ実装（Tactiq は bundled pako を使用）
  // ここでは TextDecoder ベースのフォールバック
  // ──────────────────────────────────────────

  /**
   * Base64 → Uint8Array → pako inflate → string
   * Teams の rosterUpdate は base64 + gzip で送られる
   */
  function tryInflateBase64(base64str) {
    try {
      const binary = atob(base64str)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

      // DecompressionStream API (Chrome 80+)
      const ds = new DecompressionStream('deflate')
      const writer = ds.writable.getWriter()
      const reader = ds.readable.getReader()

      writer.write(bytes)
      writer.close()

      const chunks = []
      return reader.read().then(function pump(result) {
        if (result.done) {
          return new TextDecoder().decode(concatUint8(chunks))
        }
        chunks.push(result.value)
        return reader.read().then(pump)
      })
    } catch {
      return Promise.resolve(null)
    }
  }

  function concatUint8(arrays) {
    const total = arrays.reduce((sum, a) => sum + a.length, 0)
    const result = new Uint8Array(total)
    let offset = 0
    for (const a of arrays) {
      result.set(a, offset)
      offset += a.length
    }
    return result
  }

  // ──────────────────────────────────────────
  // 参加者名マッピング
  // ──────────────────────────────────────────
  const participantNames = new Map()

  function addParticipant(id, name) {
    if (id && name) {
      participantNames.set(id, name)
      // content script に通知
      window.postMessage({
        type: 'aiba-teams-deviceinfo',
        deviceId: id,
        deviceName: name,
      }, '*')
    }
  }

  function getParticipantName(userId) {
    return participantNames.get(userId) || ''
  }

  // ──────────────────────────────────────────
  // Teams バージョン検出
  // ──────────────────────────────────────────
  function detectTeamsVersion() {
    // Light Meetings: ブラウザのみ、Angular コントローラーなし
    // 判定: DOM に Angular の jQuery データがない場合
    try {
      const el = document.documentElement
      for (const key in el) {
        if (key.startsWith('jQuery')) {
          const data = el[key]
          if (data && '$ngControllerController' in data) {
            return 'V2Calling'
          }
        }
      }
      // msteamscalling グローバルの確認
      if ('msteamscalling' in window) {
        return 'V2Calling'
      }
    } catch {
      // ignore
    }
    return 'LightMeetings'
  }

  // ──────────────────────────────────────────
  // データチャネルメッセージの処理（共通）
  // ──────────────────────────────────────────
  function processRawMessage(data) {
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

      // バイナリヘッダーをスキップして JSON 部分を見つける
      const idxBracket = text.indexOf('[')
      const idxBrace = text.indexOf('{')
      let jsonStart
      if (idxBracket === -1 && idxBrace === -1) return
      if (idxBracket === -1) jsonStart = idxBrace
      else if (idxBrace === -1) jsonStart = idxBracket
      else jsonStart = Math.min(idxBracket, idxBrace)

      const jsonStr = text.slice(jsonStart)
      const json = JSON.parse(jsonStr)

      processRecognitionResults(json, [])
    } catch {
      // パースエラーは無視
    }
  }

  /**
   * recognitionResults の配列を処理して postMessage する
   * @param {object} json - パース済みデータ
   * @param {Array} participants - 参加者リスト（V2 Calling から渡される場合）
   */
  function processRecognitionResults(json, participants) {
    const results = json.recognitionResults || json.results
    if (!results || !Array.isArray(results)) return

    for (const result of results) {
      // timestampAudioSent が含まれるエントリのみ処理（字幕データの判定）
      if (!('timestampAudioSent' in result)) continue

      const captionText = result.text || result.caption || result.transcript
      if (!captionText || captionText.trim().length === 0) continue

      const userId = result.userId || result.participantId || result.speakerId || ''
      const timestamp = result.timestampAudioSent || result.timestamp || Date.now()

      // 参加者名の解決（引数 > ローカルマップ > 空文字）
      let speaker = getParticipantName(userId)
      if (!speaker && participants.length > 0) {
        const p = participants.find(pp => pp.mri === userId || pp.deviceId === userId)
        if (p) speaker = p.displayName || p.deviceName || ''
      }

      // メッセージバージョン（重複排除用）
      const idParts = (result.id || '').split('/')
      const messageVersion = idParts.length > 1 ? parseInt(idParts[1], 10) : 0

      window.postMessage({
        type: 'aiba-teams-caption',
        text: captionText.trim(),
        userId,
        speaker,
        timestamp,
        isFinal: result.isFinal !== false,
        messageId: `${timestamp}/${userId}`,
        messageVersion,
      }, '*')
    }
  }

  // ──────────────────────────────────────────
  // WebSocket フック — 参加者名 (rosterUpdate) 取得
  // ──────────────────────────────────────────
  function installWebSocketHook() {
    const OrigWebSocket = window.WebSocket

    function HookedWebSocket(url, protocols) {
      const ws = new OrigWebSocket(url, protocols)

      if (typeof url === 'string' && url.includes('teams.microsoft.com')) {
        ws.addEventListener('message', (event) => {
          try {
            const data = typeof event.data === 'string' ? event.data : ''
            // Teams WebSocket メッセージ形式: "3:::{json}"
            if (data.startsWith('3:::')) {
              const payload = JSON.parse(data.slice(4))
              if (payload.url && payload.url.includes('/rosterUpdate/') && payload.body) {
                // base64 + gzip 圧縮されたロスター情報
                tryInflateBase64(payload.body).then((inflated) => {
                  if (!inflated) return
                  try {
                    const roster = JSON.parse(inflated)
                    if (roster.participants) {
                      for (const p of Object.values(roster.participants)) {
                        if (p.details?.displayName) {
                          addParticipant(p.details.id, p.details.displayName)
                        }
                      }
                    }
                  } catch {
                    // ロスターパースエラーは無視
                  }
                })
              }
            }
          } catch {
            // WebSocket メッセージ処理エラーは無視
          }
        })
      }

      return ws
    }

    HookedWebSocket.prototype = OrigWebSocket.prototype
    HookedWebSocket.CONNECTING = OrigWebSocket.CONNECTING
    HookedWebSocket.OPEN = OrigWebSocket.OPEN
    HookedWebSocket.CLOSING = OrigWebSocket.CLOSING
    HookedWebSocket.CLOSED = OrigWebSocket.CLOSED
    window.WebSocket = HookedWebSocket

    LOG('WebSocket フック完了（参加者名取得用）')
  }

  // ──────────────────────────────────────────
  // 経路B: RTCPeerConnection フック（Light Meetings 用）
  // ──────────────────────────────────────────
  function installRTCHook() {
    const OrigRTC = window.RTCPeerConnection
    if (!OrigRTC) {
      LOG('RTCPeerConnection が見つかりません')
      return
    }

    const origCreateDC = OrigRTC.prototype.createDataChannel
    OrigRTC.prototype.createDataChannel = function () {
      const channel = origCreateDC.apply(this, arguments)
      if (channel && channel.label === 'main-channel') {
        LOG('★ [経路B] "main-channel" を傍受（Light Meetings）')
        channel.addEventListener('message', (event) => {
          processRawMessage(event.data)
        })
      }
      return channel
    }

    // 受信チャネルも傍受
    const origOnDC = Object.getOwnPropertyDescriptor(OrigRTC.prototype, 'ondatachannel')
    if (origOnDC) {
      Object.defineProperty(OrigRTC.prototype, 'ondatachannel', {
        set(fn) {
          origOnDC.set.call(this, function (event) {
            if (event.channel && event.channel.label === 'main-channel') {
              LOG('★ [経路B] 受信 "main-channel" を傍受')
              event.channel.addEventListener('message', (msgEvent) => {
                processRawMessage(msgEvent.data)
              })
            }
            if (fn) fn.call(this, event)
          })
        },
        get() {
          return origOnDC.get.call(this)
        },
      })
    }

    // addEventListener('datachannel') もフック
    const origAEL = OrigRTC.prototype.addEventListener
    OrigRTC.prototype.addEventListener = function (type, listener, options) {
      if (type === 'datachannel') {
        const wrapped = function (event) {
          if (event.channel && event.channel.label === 'main-channel') {
            LOG('★ [経路B] addEventListener "main-channel" を傍受')
            event.channel.addEventListener('message', (msgEvent) => {
              processRawMessage(msgEvent.data)
            })
          }
          return listener.call(this, event)
        }
        return origAEL.call(this, type, wrapped, options)
      }
      return origAEL.call(this, type, listener, options)
    }

    LOG('RTCPeerConnection フック完了')
  }

  // ──────────────────────────────────────────
  // 経路A: V2 Calling — Teams 内部 API フック
  // ──────────────────────────────────────────

  /**
   * 条件が真になるまで待機（ポーリング）
   */
  function waitForCondition(condFn, interval = 500) {
    return new Promise((resolve) => {
      const check = () => {
        const result = condFn()
        if (result) return resolve(result)
        setTimeout(check, interval)
      }
      check()
    })
  }

  /**
   * Teams の Angular コントローラーから callingService を取得
   */
  function getTeamsController() {
    try {
      const el = document.documentElement
      for (const key in el) {
        if (key.startsWith('jQuery')) {
          const data = el[key]
          if (data && '$ngControllerController' in data) {
            return data.$ngControllerController
          }
        }
      }
      // msteamscalling グローバル
      if ('msteamscalling' in window) {
        return window.msteamscalling.deref?.() || window.msteamscalling
      }
    } catch {
      // ignore
    }
    return null
  }

  /**
   * 経路A: V2 Calling で字幕を開始し、イベントハンドラーをフックする
   */
  async function startV2CallingCapture(controller) {
    LOG('[経路A] V2 Calling で字幕取得を開始')

    // アクティブな通話を待機
    const callInfo = await waitForCondition(() => {
      if (!controller.callingService) return null

      if (controller.callingService.getActiveCall) {
        const call = controller.callingService.getActiveCall()
        if (call && call.state !== 7) {
          return { call, callingService: controller.callingService }
        }
      } else if (controller.callingService.callRegistry?.calls?.length) {
        const info = controller.callingService.lastOrCurrentCallInfo
        if (info) {
          const call = controller.callingService.callRegistry.calls.find(c => c._callId === info.callId)
          if (call) return { call, callingService: controller.callingService }
        }
      }
      return null
    })

    if (!callInfo) {
      LOG('[経路A] アクティブな通話が見つかりません')
      return false
    }

    const { call, callingService } = callInfo
    LOG('[経路A] アクティブな通話を検出', call._callId || '')

    // 通話が接続されるまで待機
    await waitForCondition(() => {
      const activeCall = callingService.getActiveCall?.()
      if (!activeCall) return false
      if (activeCall.callGotConnected) return true
      if (activeCall.state === 3) return true  // Connected state
      return false
    })

    // 最新の通話オブジェクトを取得
    const activeCall = callingService.getActiveCall?.() || call

    // 字幕を開始
    if (activeCall.startClosedCaption) {
      LOG('[経路A] 字幕を開始')
      try {
        activeCall.startClosedCaption()

        // 字幕が開始されるまで待機
        await waitForCondition(() => {
          try {
            return activeCall.closedCaptionsHaveBeenStarted?.() &&
                   activeCall.getClosedCaptionStatus?.() === 2
          } catch {
            return false
          }
        })
        LOG('[経路A] 字幕開始完了')
      } catch (e) {
        LOG('[経路A] 字幕開始エラー（フォールバック続行）:', e.message)
      }
    } else {
      LOG('[経路A] startClosedCaption が利用不可')
      return false
    }

    // dataChannel.subscriptions からイベントハンドラーをフック
    const subscription = activeCall.dataChannel?.subscriptions?.find(
      s => s.eventHandler?.on?.name === 'remoteUserEventsReceived'
    )

    if (subscription && subscription.eventHandler?.on) {
      const originalHandler = subscription.eventHandler.on.handler
      subscription.eventHandler.on.handler = function (eventType, data) {
        try {
          if (eventType === '3') {
            const parsed = JSON.parse(data)
            if ('recognitionResults' in parsed && Array.isArray(parsed.recognitionResults)) {
              for (const result of parsed.recognitionResults) {
                processRecognitionResults(
                  { recognitionResults: [result] },
                  activeCall.participants ? Object.values(activeCall.participants) : []
                )
              }
            }
          }
        } catch (e) {
          // パースエラーは無視
        }
        return originalHandler.apply(this, arguments)
      }

      LOG('[経路A] ★ dataChannel イベントハンドラーフック完了')

      // 参加者情報を取得
      try {
        if (activeCall.participants) {
          for (const p of Object.values(activeCall.participants)) {
            const id = p.userId || p.mri || p.id
            const name = p.displayName || p.name
            addParticipant(id, name)
          }
        }
      } catch {
        // 参加者取得エラーは無視
      }

      // 通話の終了を監視
      waitForCondition(() => {
        try {
          if (!callingService.getActiveCall) {
            return callingService.callRegistry?.calls?.length === 0
          }
          return callingService.getActiveCall() === null
        } catch {
          return true
        }
      }).then(() => {
        LOG('[経路A] 通話終了を検出')
        // ハンドラーを復元
        if (subscription.eventHandler?.on) {
          subscription.eventHandler.on.handler = originalHandler
        }
        window.postMessage({ type: 'aiba-teams-meeting-ended' }, '*')
        // 次の通話を待機
        setTimeout(() => startV2CallingMonitor(), 5000)
      })

      window.postMessage({ type: 'aiba-teams-meeting-started' }, '*')
      return true
    } else {
      LOG('[経路A] dataChannel subscriptions が見つかりません（経路B にフォールバック）')
      return false
    }
  }

  /**
   * V2 Calling の通話検出ループ
   */
  function startV2CallingMonitor() {
    const controller = getTeamsController()
    if (!controller) {
      LOG('[経路A] Teams コントローラーが見つかりません')
      return
    }
    startV2CallingCapture(controller).then((success) => {
      if (!success) {
        LOG('[経路A] V2 Calling フック失敗、経路B (RTC) のみで動作')
      }
    }).catch((e) => {
      LOG('[経路A] エラー:', e.message)
    })
  }

  // ──────────────────────────────────────────
  // 初期化
  // ──────────────────────────────────────────
  const teamsVersion = detectTeamsVersion()
  LOG(`Teams バージョン: ${teamsVersion}`)

  // WebSocket フック（参加者名取得）— 常にインストール
  installWebSocketHook()

  // 経路B: RTC フック — 常にインストール（フォールバック）
  installRTCHook()

  if (teamsVersion === 'V2Calling') {
    // 経路A: V2 Calling — DOM の準備ができてから開始
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        // Teams の内部オブジェクトが初期化されるまで少し待つ
        setTimeout(startV2CallingMonitor, 3000)
      })
    } else {
      setTimeout(startV2CallingMonitor, 3000)
    }
  } else {
    LOG('Light Meetings モード — 経路B (RTC) のみ')
  }

  LOG('Teams RTC + V2 Calling フック完了')
})()
