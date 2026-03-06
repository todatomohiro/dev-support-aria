/**
 * Ai-Ba Tools — Service Worker (Background)
 *
 * popup から受け取った streamId を offscreen document に渡して
 * Amazon Transcribe Streaming で参加者の音声を文字起こしする。
 *
 * offscreen との通信は Port ベース（sendMessage は不安定なため）。
 */
'use strict'

const LOG = (...args) => console.log('[Ai-Ba BG]', ...args)

// 状態管理
let offscreenCreated = false
let offscreenPort = null
let captureActive = false

async function ensureOffscreen() {
  if (offscreenPort) return // Port があれば準備完了

  if (!offscreenCreated) {
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: 'タブ音声キャプチャと Transcribe 文字起こし',
      })
      offscreenCreated = true
      LOG('Offscreen document 作成完了')
    } catch (e) {
      if (e.message?.includes('Only a single offscreen')) {
        offscreenCreated = true
      } else {
        throw e
      }
    }
  }

  // offscreen が Port 接続するのを待つ（最大 5 秒）
  if (!offscreenPort) {
    LOG('Offscreen Port 接続待ち...')
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (offscreenPort) {
          clearInterval(check)
          resolve()
        }
      }, 100)
      setTimeout(() => {
        clearInterval(check)
        resolve()
      }, 5000)
    })
    if (!offscreenPort) {
      throw new Error('Offscreen document が応答しません')
    }
  }
}

// Offscreen document からの Port 接続
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'offscreen-keepalive') {
    LOG('Offscreen Port 接続')
    offscreenPort = port

    // offscreen → background のメッセージ受信
    port.onMessage.addListener((message) => {
      // content script に転送
      if (message.type === 'tab-transcript' || message.type === 'tab-capture-status') {
        if (message.type === 'tab-capture-status') {
          if (message.status === 'error' || message.status === 'stopped') {
            captureActive = false
          }
        }
        forwardToContentScripts(message)
      }
    })

    port.onDisconnect.addListener(() => {
      offscreenPort = null
      offscreenCreated = false
      captureActive = false
      LOG('Offscreen Port 切断')
    })
  }
})

function forwardToContentScripts(message) {
  chrome.tabs.query(
    { url: ['https://meet.google.com/*', 'https://*.zoom.us/*', 'https://teams.microsoft.com/*'] },
    (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {})
      }
    }
  )
}

// メッセージ処理（popup / content script から）
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // popup から: streamId 付きでキャプチャ開始
  if (message.type === 'start-tab-capture-with-stream') {
    handleStartWithStream(message.streamId, message.tabId)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message }))
    return true
  }

  // content script から: popup 経由でないと失敗する旨を通知
  if (message.type === 'start-tab-capture') {
    sendResponse({
      error: '拡張機能アイコンをクリックして「タブ音声キャプチャを開始」ボタンを押してください',
    })
    return true
  }

  // 停止
  if (message.type === 'stop-tab-capture') {
    handleStopCapture()
    sendResponse({ ok: true })
    return true
  }

  // 状態問い合わせ
  if (message.type === 'get-capture-status') {
    sendResponse({ isCapturing: captureActive })
    return true
  }
})

async function handleStartWithStream(streamId, tabId) {
  LOG(`タブキャプチャ開始: streamId=${streamId}, tab=${tabId}`)

  try {
    await ensureOffscreen()
    LOG('Offscreen 準備完了、Port 経由でキャプチャ開始')

    offscreenPort.postMessage({
      type: 'offscreen-start-capture',
      streamId,
      tabId,
    })

    captureActive = true
    return { ok: true }
  } catch (err) {
    LOG('キャプチャ開始エラー:', err)
    return { error: err.message }
  }
}

function handleStopCapture() {
  LOG('タブキャプチャ停止')
  captureActive = false
  if (offscreenPort) {
    offscreenPort.postMessage({ type: 'offscreen-stop-capture' })
  }
}
