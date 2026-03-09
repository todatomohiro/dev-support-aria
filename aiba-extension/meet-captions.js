/**
 * Ai-Ba Tools — Google Meet 字幕受信 (v14: collections チャネルから話者名取得)
 *
 * meet-rtc-hook.js は manifest.json の "world": "MAIN" で
 * ページコンテキストに直接注入される（最速タイミング）。
 * このスクリプトは RTC フックからの postMessage を受信し、
 * tool-noter.js に CustomEvent で転送する。
 *
 * 話者名の取得:
 *   1. collections チャネルから deviceId → deviceName マッピングを受信
 *   2. captions チャネルの deviceId をマッピングで名前に変換
 *   3. 名前が未取得の場合は「参加者」と表示
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

  /** deviceId → deviceName のマッピング */
  const deviceNames = new Map()

  // ──────────────────────────────────────────
  // RTC フックからのメッセージ受信
  // ──────────────────────────────────────────
  window.addEventListener('message', (event) => {
    if (event.source !== window) return

    // デバイス情報（deviceId → deviceName マッピング）
    if (event.data?.type === 'aiba-rtc-deviceinfo') {
      const { deviceId, deviceName } = event.data
      if (deviceId && deviceName) {
        const isNew = !deviceNames.has(deviceId)
        deviceNames.set(deviceId, deviceName)
        if (isNew) {
          LOG(`デバイス名登録: ${deviceId} → "${deviceName}"`)
          document.dispatchEvent(new CustomEvent('aiba-deviceinfo', {
            detail: { deviceId, deviceName, deviceNames: Object.fromEntries(deviceNames) },
          }))
        }
      }
      return
    }

    // 字幕データ
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

    // 話者名を取得（deviceNames マップから）
    const speaker = deviceNames.get(deviceId) || '参加者'

    // 同じデバイスの同じテキストはスキップ
    if (deviceId === lastDeviceId && text === lastText) return

    const isNewDevice = deviceId !== lastDeviceId

    // 前回の字幕を確定
    if (isNewDevice && lastText) {
      const prevSpeaker = deviceNames.get(lastDeviceId) || '参加者'
      dispatchCaption(prevSpeaker, lastText, true)
    }

    lastDeviceId = deviceId
    lastText = text

    // 暫定結果を送信
    dispatchCaption(speaker, text, false)

    // 確定タイマーリセット
    if (finalizeTimer) clearTimeout(finalizeTimer)
    finalizeTimer = setTimeout(() => {
      if (lastText) {
        const s = deviceNames.get(lastDeviceId) || '参加者'
        dispatchCaption(s, lastText, true)
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
  LOG('初期化 (v14: collections チャネルから話者名取得)')

  setTimeout(() => {
    document.dispatchEvent(new CustomEvent('aiba-captions-status', {
      detail: { status: captionReceived ? 'active' : 'waiting' },
    }))
  }, 3000)
})()
