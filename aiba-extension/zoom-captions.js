/**
 * Ai-Ba Tools — Zoom 字幕受信
 *
 * zoom-hook.js（ページコンテキスト）が fetch/XHR/WebSocket をフックし
 * 字幕データを window.postMessage で送信する。
 * この content script はメッセージを受信し tool-noter.js に転送する。
 */
;(function () {
  'use strict'

  if (window.__aibaZoomCaptionsInjected) return
  window.__aibaZoomCaptionsInjected = true

  const LOG = (...args) => console.log('[Ai-Ba Zoom Captions]', ...args)

  // フックスクリプトの注入
  function injectHook() {
    const script = document.createElement('script')
    script.src = chrome.runtime.getURL('zoom-hook.js')
    script.type = 'text/javascript'
    ;(document.head || document.documentElement).prepend(script)
    script.onload = () => {
      LOG('Zoom フックスクリプト注入完了')
      script.remove()
    }
  }

  // 状態
  let lastText = ''
  let finalizeTimer = null
  let captionReceived = false

  // postMessage 受信
  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    if (event.data?.type !== 'aiba-zoom-caption') return

    const { text, speaker } = event.data
    if (!text) return

    if (!captionReceived) {
      captionReceived = true
      LOG('★ Zoom 字幕受信開始')
      document.dispatchEvent(new CustomEvent('aiba-captions-status', {
        detail: { status: 'active' },
      }))
    }

    // 同じテキストはスキップ
    if (text === lastText) return
    lastText = text

    dispatchCaption(speaker || '参加者', text, false)
    resetFinalizeTimer(speaker)
  })

  function resetFinalizeTimer(speaker) {
    if (finalizeTimer) clearTimeout(finalizeTimer)
    finalizeTimer = setTimeout(() => {
      if (lastText) {
        dispatchCaption(speaker || '参加者', lastText, true)
        lastText = ''
      }
    }, 3000)
  }

  function dispatchCaption(speaker, text, isFinal) {
    document.dispatchEvent(new CustomEvent('aiba-caption', {
      detail: { speaker, text, isFinal, timestamp: Date.now() },
    }))
  }

  // 初期化
  LOG('初期化 (Zoom fetch/WS 方式)')
  injectHook()

  setTimeout(() => {
    document.dispatchEvent(new CustomEvent('aiba-captions-status', {
      detail: { status: captionReceived ? 'active' : 'waiting' },
    }))
  }, 3000)
})()
