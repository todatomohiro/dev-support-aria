/**
 * Ai-Ba Tools — Google Meet 字幕受信 (v5: RTC データチャネル方式)
 *
 * meet-rtc-hook.js（ページコンテキスト）が RTCPeerConnection を
 * フックして字幕データを window.postMessage で送信する。
 * このスクリプト（content script）はそのメッセージを受信し、
 * tool-noter.js に CustomEvent で転送する。
 *
 * DOM 構造には一切依存しない。
 */
;(function () {
  'use strict'

  if (window.__aibaCaptionsInjected) return
  window.__aibaCaptionsInjected = true

  const LOG = (...args) => console.log('[Ai-Ba Captions]', ...args)

  // ──────────────────────────────────────────
  // RTC フックスクリプトの注入
  // ──────────────────────────────────────────
  function injectRtcHook() {
    const script = document.createElement('script')
    script.src = chrome.runtime.getURL('meet-rtc-hook.js')
    script.type = 'text/javascript'
    ;(document.head || document.documentElement).prepend(script)
    script.onload = () => {
      LOG('RTC フックスクリプト注入完了')
      script.remove()
    }
    script.onerror = () => {
      LOG('RTC フックスクリプト注入失敗')
    }
  }

  // ──────────────────────────────────────────
  // 状態
  // ──────────────────────────────────────────
  let lastText = ''
  let lastDeviceId = ''
  let finalizeTimer = null
  let captionReceived = false

  // デバイス ID → 話者名のマッピング（将来拡張用）
  const deviceNames = new Map()

  // ──────────────────────────────────────────
  // RTC フックからのメッセージ受信
  // ──────────────────────────────────────────
  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    if (event.data?.type !== 'aiba-rtc-caption') return

    const { deviceId, text, messageVersion } = event.data
    if (!text) return

    // 初回受信時にステータスを通知
    if (!captionReceived) {
      captionReceived = true
      LOG('★ 字幕データ受信開始（RTC データチャネル経由）')
      document.dispatchEvent(new CustomEvent('aiba-captions-status', {
        detail: { status: 'active' },
      }))
    }

    const speaker = deviceNames.get(deviceId) || getSpeakerName(deviceId)

    // 同じデバイスの同じテキストはスキップ
    if (deviceId === lastDeviceId && text === lastText) return

    const isNewDevice = deviceId !== lastDeviceId

    // 前回の字幕を確定
    if (isNewDevice && lastText) {
      const prevSpeaker = deviceNames.get(lastDeviceId) || getSpeakerName(lastDeviceId)
      dispatchCaption(prevSpeaker, lastText, true)
    }

    lastDeviceId = deviceId
    lastText = text

    // 暫定結果を送信
    dispatchCaption(speaker, text, false)

    // 確定タイマーリセット
    resetFinalizeTimer()
  })

  /**
   * デバイス ID から表示名を推定する。
   * Google Meet のデバイス ID は通常 "devices/xxx" の形式。
   */
  function getSpeakerName(deviceId) {
    if (!deviceId) return '参加者'
    // デバイス ID は不透明な文字列なので短縮して表示
    return '参加者'
  }

  // ──────────────────────────────────────────
  // 確定タイマー
  // ──────────────────────────────────────────
  function resetFinalizeTimer() {
    if (finalizeTimer) clearTimeout(finalizeTimer)
    finalizeTimer = setTimeout(() => {
      if (lastText) {
        const speaker = deviceNames.get(lastDeviceId) || getSpeakerName(lastDeviceId)
        dispatchCaption(speaker, lastText, true)
        lastText = ''
        lastDeviceId = ''
      }
    }, 3000)
  }

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
  LOG('初期化 (v5: RTC データチャネル方式)')
  injectRtcHook()

  // 初期ステータス（字幕データ受信前）
  setTimeout(() => {
    document.dispatchEvent(new CustomEvent('aiba-captions-status', {
      detail: { status: captionReceived ? 'active' : 'waiting' },
    }))
  }, 3000)
})()
