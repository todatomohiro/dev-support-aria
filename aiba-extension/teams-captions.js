/**
 * Ai-Ba Tools — MS Teams 字幕受信 (Content Script)
 *
 * teams-rtc-hook.js（ページコンテキスト）から postMessage 経由で
 * 字幕データと参加者情報を受信し、tool-noter.js に CustomEvent で転送する。
 *
 * 受信メッセージ:
 *   - aiba-teams-caption: 字幕データ（text, userId, speaker, isFinal, messageId, messageVersion）
 *   - aiba-teams-deviceinfo: 参加者名マッピング（deviceId, deviceName）
 *   - aiba-teams-meeting-started: 会議開始通知
 *   - aiba-teams-meeting-ended: 会議終了通知
 */
;(function () {
  'use strict'

  if (window.__aibaTeamsCaptionsInjected) return
  window.__aibaTeamsCaptionsInjected = true

  const LOG = (...args) => console.log('[Ai-Ba Teams Captions]', ...args)

  // RTC フックスクリプトの注入
  function injectHook() {
    const script = document.createElement('script')
    script.src = chrome.runtime.getURL('teams-rtc-hook.js')
    script.type = 'text/javascript'
    ;(document.head || document.documentElement).prepend(script)
    script.onload = () => {
      LOG('Teams RTC フックスクリプト注入完了')
      script.remove()
    }
  }

  // ──────────────────────────────────────────
  // 参加者名マッピング（content script 側）
  // ──────────────────────────────────────────
  const deviceNames = new Map()

  // ──────────────────────────────────────────
  // 字幕の重複排除と確定処理
  // ──────────────────────────────────────────
  // messageId ベースの重複排除（Tactiq 方式）
  const pendingMessages = new Map()  // messageId → { text, speaker, version, timer }
  let captionReceived = false

  /**
   * 字幕メッセージの処理
   * 同じ messageId の新バージョンで更新、タイムアウトで確定
   */
  function handleCaption(data) {
    const { text, userId, speaker, isFinal, messageId, messageVersion } = data
    if (!text) return

    if (!captionReceived) {
      captionReceived = true
      LOG('★ Teams 字幕受信開始')
      document.dispatchEvent(new CustomEvent('aiba-captions-status', {
        detail: { status: 'active' },
      }))
    }

    // 参加者名の解決
    const displayName = speaker || deviceNames.get(userId) || '参加者'

    const id = messageId || `${Date.now()}/${userId}`
    const version = messageVersion || 0

    const existing = pendingMessages.get(id)

    if (existing) {
      // 同じ or 古いバージョンはスキップ
      if (version <= existing.version && !isFinal) return

      // タイマーをクリア
      if (existing.timer) clearTimeout(existing.timer)
    }

    if (isFinal) {
      // 確定メッセージ
      pendingMessages.delete(id)
      dispatchCaption(text, true, displayName)
    } else {
      // interim メッセージ — 表示更新 + 3秒タイムアウトで自動確定
      dispatchCaption(text, false, displayName)

      const timer = setTimeout(() => {
        const msg = pendingMessages.get(id)
        if (msg) {
          pendingMessages.delete(id)
          dispatchCaption(msg.text, true, msg.speaker)
        }
      }, 3000)

      pendingMessages.set(id, { text, speaker: displayName, version, timer })
    }
  }

  function dispatchCaption(text, isFinal, speaker) {
    document.dispatchEvent(new CustomEvent('aiba-caption', {
      detail: { speaker: speaker || '参加者', text, isFinal, timestamp: Date.now() },
    }))
  }

  // ──────────────────────────────────────────
  // postMessage 受信
  // ──────────────────────────────────────────
  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    const data = event.data
    if (!data || typeof data !== 'object') return

    switch (data.type) {
      case 'aiba-teams-caption':
        handleCaption(data)
        break

      case 'aiba-teams-deviceinfo':
        // 参加者名マッピングの更新
        if (data.deviceId && data.deviceName) {
          deviceNames.set(data.deviceId, data.deviceName)
          LOG(`参加者: ${data.deviceName} (${data.deviceId.slice(0, 16)}...)`)
        }
        break

      case 'aiba-teams-meeting-started':
        LOG('会議開始通知を受信')
        document.dispatchEvent(new CustomEvent('aiba-captions-status', {
          detail: { status: 'active' },
        }))
        break

      case 'aiba-teams-meeting-ended':
        LOG('会議終了通知を受信')
        break
    }
  })

  // ──────────────────────────────────────────
  // 初期化
  // ──────────────────────────────────────────
  LOG('初期化 (Teams RTC + V2 Calling 方式)')
  injectHook()

  // 3秒後にステータスを確認
  setTimeout(() => {
    document.dispatchEvent(new CustomEvent('aiba-captions-status', {
      detail: { status: captionReceived ? 'active' : 'waiting' },
    }))
  }, 3000)
})()
