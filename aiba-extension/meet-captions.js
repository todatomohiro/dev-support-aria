/**
 * Ai-Ba Tools — Google Meet 字幕スクレイパー
 *
 * Google Meet の字幕（Captions）DOM を MutationObserver で監視し、
 * 話者名 + テキストを抽出して tool-noter.js に転送する。
 *
 * 字幕が OFF の場合は自動で ON にする。
 * tabCapture/desktopCapture は不要。
 */
;(function () {
  'use strict'

  if (window.__aibaCaptionsInjected) return
  window.__aibaCaptionsInjected = true

  const LOG = (...args) => console.log('[Ai-Ba Captions]', ...args)

  // ──────────────────────────────────────────
  // 字幕コンテナの検出（複数セレクタでフォールバック）
  // ──────────────────────────────────────────
  const CAPTION_SELECTORS = [
    'div[role="region"][tabindex="0"]',        // aria ベース（最も安定）
    '[role="region"][aria-label*="aption"]',    // aria-label に "Caption" を含む
  ]

  // 話者名の抽出セレクタ
  const SPEAKER_CLASS = '.jxFHg'

  // ──────────────────────────────────────────
  // 状態
  // ──────────────────────────────────────────
  let captionObserver = null
  let isObserving = false
  let lastSpeaker = ''
  let lastText = ''
  let debounceTimer = null

  // ──────────────────────────────────────────
  // 字幕の自動有効化
  // ──────────────────────────────────────────
  function enableCaptions() {
    // 方法1: aria-label で CC ボタンを探す
    const ccBtn = document.querySelector('button[aria-label*="Turn on captions"]')
      || document.querySelector('button[aria-label*="字幕をオン"]')
      || document.querySelector('button[aria-label*="字幕を表示"]')
    if (ccBtn) {
      LOG('字幕ボタンを自動クリック')
      ccBtn.click()
      return true
    }

    // 方法2: アイコンテキストで探す
    const icons = document.querySelectorAll('.google-symbols, .material-icons-extended')
    for (const icon of icons) {
      if (/closed_caption_off/.test(icon.textContent)) {
        const btn = icon.closest('button')
        if (btn) {
          LOG('字幕アイコンボタンを自動クリック')
          btn.click()
          return true
        }
      }
    }

    return false
  }

  function isCaptionsOn() {
    return !!(
      document.querySelector('button[aria-label*="Turn off captions"]')
      || document.querySelector('button[aria-label*="字幕をオフ"]')
      || document.querySelector('button[aria-label*="字幕を非表示"]')
    )
  }

  // ──────────────────────────────────────────
  // 字幕コンテナの検出
  // ──────────────────────────────────────────
  function findCaptionContainer() {
    for (const sel of CAPTION_SELECTORS) {
      const el = document.querySelector(sel)
      if (el) return el
    }
    return null
  }

  // ──────────────────────────────────────────
  // 字幕テキストの抽出
  // ──────────────────────────────────────────
  function extractCaptions(container) {
    if (!container) return []

    const results = []
    // 字幕コンテナ内の各エントリを走査
    const children = container.children
    for (const child of children) {
      // 話者名を取得
      let speaker = ''
      const speakerEl = child.querySelector(SPEAKER_CLASS)
      if (speakerEl) {
        speaker = speakerEl.textContent.trim()
      }
      if (!speaker) {
        // フォールバック: 最初のテキストノードが話者名の場合
        const firstChild = child.firstElementChild
        if (firstChild && firstChild.children.length === 0) {
          speaker = firstChild.textContent.trim()
        }
      }

      // テキスト部分を取得（話者名以外のテキスト）
      let text = ''
      if (speakerEl) {
        // 話者名要素以降のテキストを収集
        const allText = child.textContent.trim()
        const speakerText = speakerEl.textContent.trim()
        text = allText.replace(speakerText, '').trim()
      } else {
        text = child.textContent.trim()
      }

      if (text) {
        results.push({ speaker: speaker || '参加者', text })
      }
    }
    return results
  }

  // ──────────────────────────────────────────
  // MutationObserver コールバック
  // ──────────────────────────────────────────
  function onCaptionMutation() {
    // 字幕はリアルタイム更新されるためデバウンス
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      const container = findCaptionContainer()
      if (!container) return

      const captions = extractCaptions(container)
      if (captions.length === 0) return

      // 最新の字幕を取得（通常は最後のエントリが最新）
      const latest = captions[captions.length - 1]

      // 重複排除: 同じ話者・同じテキストはスキップ
      if (latest.speaker === lastSpeaker && latest.text === lastText) return

      // テキストが前回の延長の場合は暫定結果として扱う
      const isExtension = latest.speaker === lastSpeaker
        && lastText
        && latest.text.startsWith(lastText)

      if (isExtension) {
        // 暫定結果（テキストが伸びている最中）
        dispatchCaption(latest.speaker, latest.text, false)
      } else {
        // 前回の結果が確定（新しい話者 or 完全に異なるテキスト）
        if (lastText) {
          dispatchCaption(lastSpeaker, lastText, true)
        }
        // 新しい暫定結果
        dispatchCaption(latest.speaker, latest.text, false)
      }

      lastSpeaker = latest.speaker
      lastText = latest.text
    }, 200)
  }

  // 字幕が消えた時（確定）を検出するタイマー
  let clearTimer = null
  function resetClearTimer() {
    if (clearTimer) clearTimeout(clearTimer)
    clearTimer = setTimeout(() => {
      // 2秒間更新がなければ最後の字幕を確定
      if (lastText) {
        dispatchCaption(lastSpeaker, lastText, true)
        lastSpeaker = ''
        lastText = ''
      }
    }, 2000)
  }

  // ──────────────────────────────────────────
  // tool-noter.js への転送
  // ──────────────────────────────────────────
  function dispatchCaption(speaker, text, isFinal) {
    resetClearTimer()
    document.dispatchEvent(new CustomEvent('aiba-caption', {
      detail: { speaker, text, isFinal, timestamp: Date.now() },
    }))
  }

  // ──────────────────────────────────────────
  // 監視の開始
  // ──────────────────────────────────────────
  function startObserving() {
    if (isObserving) return

    const container = findCaptionContainer()
    if (!container) return false

    captionObserver = new MutationObserver(onCaptionMutation)
    captionObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    isObserving = true
    LOG('字幕 DOM 監視を開始')
    document.dispatchEvent(new CustomEvent('aiba-captions-status', {
      detail: { status: 'active' },
    }))
    return true
  }

  function stopObserving() {
    if (captionObserver) {
      captionObserver.disconnect()
      captionObserver = null
    }
    isObserving = false
    lastSpeaker = ''
    lastText = ''
    LOG('字幕 DOM 監視を停止')
  }

  // ──────────────────────────────────────────
  // 初期化: 字幕コンテナが出現するまでポーリング
  // ──────────────────────────────────────────
  function init() {
    LOG('初期化開始')

    // 字幕コンテナが見つかるまで body を監視
    const bodyObserver = new MutationObserver(() => {
      // 字幕が OFF なら ON にする
      if (!isCaptionsOn()) {
        enableCaptions()
      }

      // 字幕コンテナが出現したら監視開始
      if (!isObserving && findCaptionContainer()) {
        if (startObserving()) {
          bodyObserver.disconnect()
        }
      }
    })

    // 会議画面が完全に読み込まれるのを待つ
    const waitForMeeting = () => {
      if (document.body) {
        bodyObserver.observe(document.body, { childList: true, subtree: true })

        // 既に字幕が ON で コンテナがある場合
        if (findCaptionContainer()) {
          startObserving()
          bodyObserver.disconnect()
        }
      } else {
        requestAnimationFrame(waitForMeeting)
      }
    }
    waitForMeeting()

    // 安全装置: 60秒後に bodyObserver を停止
    setTimeout(() => {
      if (!isObserving) {
        bodyObserver.disconnect()
        LOG('字幕コンテナが見つかりませんでした（タイムアウト）')
        document.dispatchEvent(new CustomEvent('aiba-captions-status', {
          detail: { status: 'unavailable' },
        }))
      }
    }, 60000)
  }

  // ── 外部からの制御 ──
  document.addEventListener('aiba-captions-control', (e) => {
    if (e.detail?.action === 'start') {
      if (!isCaptionsOn()) enableCaptions()
      // 少し待ってからコンテナを探す
      setTimeout(() => {
        if (!isObserving) {
          if (!startObserving()) {
            LOG('字幕コンテナが見つかりません。字幕を手動で ON にしてください。')
          }
        }
      }, 1000)
    }
    if (e.detail?.action === 'stop') {
      stopObserving()
    }
  })

  init()
  LOG('Google Meet 字幕スクレイパー読み込み完了')
})()
