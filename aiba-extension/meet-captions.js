/**
 * Ai-Ba Tools — Google Meet 字幕受信 (v10: RTC データチャネル方式)
 *
 * meet-rtc-hook.js は manifest.json の "world": "MAIN" で
 * ページコンテキストに直接注入される（最速タイミング）。
 * このスクリプトは RTC フックからの postMessage を受信し、
 * tool-noter.js に CustomEvent で転送する。
 */
;(function () {
  'use strict'

  if (window.__aibaCaptionsInjected) return
  window.__aibaCaptionsInjected = true

  const LOG = (...args) => console.log('[Ai-Ba Captions]', ...args)

  // ──────────────────────────────────────────
  // 状態
  // ──────────────────────────────────────────
  let lastText = ''
  let lastDeviceId = ''
  let finalizeTimer = null
  let captionReceived = false

  // ──────────────────────────────────────────
  // RTC フックからのメッセージ受信
  // ──────────────────────────────────────────
  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    if (event.data?.type !== 'aiba-rtc-caption') return

    const { deviceId, text } = event.data
    if (!text) return

    // 初回受信時にステータスを通知
    if (!captionReceived) {
      captionReceived = true
      LOG('★ 字幕データ受信開始（RTC データチャネル経由）')
      document.dispatchEvent(new CustomEvent('aiba-captions-status', {
        detail: { status: 'active' },
      }))
    }

    // 同じデバイスの同じテキストはスキップ
    if (deviceId === lastDeviceId && text === lastText) return

    const isNewDevice = deviceId !== lastDeviceId

    // 前回の字幕を確定
    if (isNewDevice && lastText) {
      dispatchCaption('参加者', lastText, true)
    }

    lastDeviceId = deviceId
    lastText = text

    // 暫定結果を送信
    dispatchCaption('参加者', text, false)

    // 確定タイマーリセット
    if (finalizeTimer) clearTimeout(finalizeTimer)
    finalizeTimer = setTimeout(() => {
      if (lastText) {
        dispatchCaption('参加者', lastText, true)
        lastText = ''
        lastDeviceId = ''
      }
    }, 3000)
  })

  // ──────────────────────────────────────────
  // tool-noter.js への転送
  // ──────────────────────────────────────────
  function dispatchCaption(speaker, text, isFinal) {
    document.dispatchEvent(new CustomEvent('aiba-caption', {
      detail: { speaker, text, isFinal, timestamp: Date.now() },
    }))
  }

  // ──────────────────────────────────────────
  // 初期化
  // ──────────────────────────────────────────
  LOG('初期化 (v10: RTC — world:MAIN 直接注入)')

  // 初期ステータス（字幕データ受信前）
  setTimeout(() => {
    document.dispatchEvent(new CustomEvent('aiba-captions-status', {
      detail: { status: captionReceived ? 'active' : 'waiting' },
    }))
  }, 3000)
})()
