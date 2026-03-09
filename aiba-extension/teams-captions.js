/**
 * Ai-Ba Tools — MS Teams 字幕受信
 *
 * teams-rtc-hook.js（ページコンテキスト）が RTCPeerConnection をフックし
 * "main-channel" から字幕データを取得、window.postMessage で送信する。
 * この content script はメッセージを受信し tool-noter.js に転送する。
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

  // 状態
  let lastText = ''
  let lastUserId = ''
  let finalizeTimer = null
  let captionReceived = false

  // postMessage 受信
  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    if (event.data?.type !== 'aiba-teams-caption') return

    const { text, userId, speaker, isFinal } = event.data
    if (!text) return

    if (!captionReceived) {
      captionReceived = true
      LOG('★ Teams 字幕受信開始')
      document.dispatchEvent(new CustomEvent('aiba-captions-status', {
        detail: { status: 'active' },
      }))
    }

    const displayName = speaker || '参加者'

    // 同じテキストはスキップ
    if (userId === lastUserId && text === lastText) return

    const isNewUser = userId !== lastUserId

    // 前回の字幕を確定
    if (isNewUser && lastText) {
      dispatchCaption(lastText, true)
    }

    lastUserId = userId
    lastText = text

    if (isFinal) {
      dispatchCaption(text, true, displayName)
      lastText = ''
      lastUserId = ''
    } else {
      dispatchCaption(text, false, displayName)
      resetFinalizeTimer(displayName)
    }
  })

  function resetFinalizeTimer(speaker) {
    if (finalizeTimer) clearTimeout(finalizeTimer)
    finalizeTimer = setTimeout(() => {
      if (lastText) {
        dispatchCaption(lastText, true, speaker || '参加者')
        lastText = ''
        lastUserId = ''
      }
    }, 3000)
  }

  function dispatchCaption(text, isFinal, speaker) {
    document.dispatchEvent(new CustomEvent('aiba-caption', {
      detail: { speaker: speaker || '参加者', text, isFinal, timestamp: Date.now() },
    }))
  }

  // 初期化
  LOG('初期化 (Teams RTC 方式)')
  injectHook()

  setTimeout(() => {
    document.dispatchEvent(new CustomEvent('aiba-captions-status', {
      detail: { status: captionReceived ? 'active' : 'waiting' },
    }))
  }, 3000)
})()
