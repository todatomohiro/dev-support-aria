/**
 * Ai-Ba Tools — Zoom fetch/XHR 傍受 + Redux ストア監視
 *
 * ページコンテキストで実行（content script から inject）。
 * Zoom Web Client の字幕データを取得する。
 *
 * 方式:
 *   1. fetch / XMLHttpRequest をフックして字幕関連の API レスポンスを傍受
 *   2. WebSocket メッセージを傍受（Zoom はリアルタイム通信に WS を使用）
 *   3. Redux ストアからキャプション状態を監視
 */
;(function () {
  'use strict'

  if (window.__aibaZoomHookInstalled) return
  window.__aibaZoomHookInstalled = true

  const LOG = (...args) => console.log('[Ai-Ba Zoom]', ...args)

  // ──────────────────────────────────────────
  // fetch フック
  // ──────────────────────────────────────────
  const origFetch = window.fetch
  window.fetch = async function (...args) {
    const response = await origFetch.apply(this, args)

    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || ''

      // 字幕・トランスクリプト関連の API を検出
      if (/caption|transcript|closedcaption|cc_|subtitle/i.test(url)) {
        LOG('字幕関連 fetch 検出:', url)
        const clone = response.clone()
        clone.json().then((data) => {
          processCaptionData(data, 'fetch')
        }).catch(() => {})
      }
    } catch {}

    return response
  }

  // ──────────────────────────────────────────
  // XMLHttpRequest フック
  // ──────────────────────────────────────────
  const origXhrOpen = XMLHttpRequest.prototype.open
  const origXhrSend = XMLHttpRequest.prototype.send

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__aibaUrl = String(url)
    return origXhrOpen.call(this, method, url, ...rest)
  }

  XMLHttpRequest.prototype.send = function (body) {
    const url = this.__aibaUrl || ''

    if (/caption|transcript|closedcaption|cc_|subtitle/i.test(url)) {
      LOG('字幕関連 XHR 検出:', url)
      this.addEventListener('load', () => {
        try {
          const data = JSON.parse(this.responseText)
          processCaptionData(data, 'xhr')
        } catch {}
      })
    }

    return origXhrSend.call(this, body)
  }

  // ──────────────────────────────────────────
  // WebSocket フック
  // ──────────────────────────────────────────
  const OrigWebSocket = window.WebSocket
  window.WebSocket = function (...args) {
    const ws = new OrigWebSocket(...args)

    ws.addEventListener('message', (event) => {
      try {
        let data
        if (typeof event.data === 'string') {
          // JSON メッセージの場合
          try {
            data = JSON.parse(event.data)
          } catch {
            return
          }
        } else {
          return
        }

        // 字幕関連のメッセージを検出
        if (data.type === 'caption' || data.type === 'closedcaption' ||
            data.evt === 7937 || // Zoom CC event code
            data.body?.closedCaption || data.body?.caption) {
          processCaptionData(data, 'ws')
        }
      } catch {}
    })

    return ws
  }
  window.WebSocket.prototype = OrigWebSocket.prototype
  Object.keys(OrigWebSocket).forEach((key) => {
    try { window.WebSocket[key] = OrigWebSocket[key] } catch {}
  })

  // ──────────────────────────────────────────
  // 字幕データの処理
  // ──────────────────────────────────────────
  function processCaptionData(data, source) {
    if (!data) return

    LOG('字幕データ受信 (' + source + '):', JSON.stringify(data).substring(0, 200))

    // 形式 1: { text, displayName, ... }
    if (data.text) {
      dispatch(data.text, data.displayName || data.name || data.userName || '')
      return
    }

    // 形式 2: { body: { closedCaption: { text, ... } } }
    const cc = data.body?.closedCaption || data.body?.caption
    if (cc) {
      const text = cc.text || cc.message || cc.caption
      const speaker = cc.displayName || cc.name || cc.userName || ''
      if (text) {
        dispatch(text, speaker)
        return
      }
    }

    // 形式 3: { captions: [{ text, speakerName }] }
    const captions = data.captions || data.results || data.records
    if (Array.isArray(captions)) {
      for (const item of captions) {
        const text = item.text || item.caption || item.message
        const speaker = item.speakerName || item.displayName || item.name || ''
        if (text) {
          dispatch(text, speaker)
        }
      }
      return
    }

    // 再帰的にオブジェクトを探索して text フィールドを見つける
    findCaptionInObject(data, 0)
  }

  function findCaptionInObject(obj, depth) {
    if (depth > 3 || !obj || typeof obj !== 'object') return

    // text + 何らかの ID/名前 がある場合
    if (typeof obj.text === 'string' && obj.text.length > 2) {
      const speaker = obj.displayName || obj.name || obj.userName || obj.speakerName || ''
      dispatch(obj.text, speaker)
      return
    }

    for (const key of Object.keys(obj)) {
      if (/caption|transcript|subtitle|cc/i.test(key)) {
        findCaptionInObject(obj[key], depth + 1)
      }
    }
  }

  function dispatch(text, speaker) {
    window.postMessage({
      type: 'aiba-zoom-caption',
      text: text.trim(),
      speaker: speaker || '',
      timestamp: Date.now(),
    }, '*')
  }

  // ──────────────────────────────────────────
  // Redux ストア監視（Zoom は Redux を使用）
  // ──────────────────────────────────────────
  function watchReduxStore() {
    // Zoom の Redux ストアは __NEXT_DATA__ やグローバルに露出していることがある
    const checkInterval = setInterval(() => {
      try {
        // 方法 1: document.__STORE__
        const store = window.__STORE__ || window.__store__ || window.app?.store
        if (store && store.getState) {
          const state = store.getState()
          const cc = state.closedCaption || state.caption || state.transcript
          if (cc?.text) {
            dispatch(cc.text, cc.speakerName || '')
          }
        }
      } catch {}
    }, 1000)

    // 30秒後に停止（見つからなかった場合）
    setTimeout(() => clearInterval(checkInterval), 30000)
  }

  // ──────────────────────────────────────────
  // 初期化
  // ──────────────────────────────────────────
  LOG('fetch/XHR/WebSocket フック完了')
  setTimeout(watchReduxStore, 5000)
})()
