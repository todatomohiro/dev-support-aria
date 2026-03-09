/**
 * Ai-Ba Tools — Google Meet 字幕スクレイパー (v3)
 *
 * Google Meet の字幕テキストを取得する。
 *
 * 検出戦略（優先度順）:
 *   1. aria-live 属性を持つ要素（アクセシビリティ用の字幕領域）
 *   2. 既知の jsname 属性（Google 更新で変わる可能性あり）
 *   3. body 全体の characterData 変更からフィルタリング
 */
;(function () {
  'use strict'

  if (window.__aibaCaptionsInjected) return
  window.__aibaCaptionsInjected = true

  const LOG = (...args) => console.log('[Ai-Ba Captions]', ...args)
  const DEBUG = (...args) => console.debug('[Ai-Ba Captions]', ...args)

  // ──────────────────────────────────────────
  // 状態
  // ──────────────────────────────────────────
  let isObserving = false
  let captionObserver = null
  let scanInterval = null

  let currentSpeaker = ''
  let currentText = ''
  let finalizeTimer = null

  // 検出した字幕コンテナ（キャッシュ）
  let captionContainer = null

  // 拡張機能自身の UI
  const AIBA_SELECTOR = '#aiba-toolbar, #aiba-noter-panel, #aiba-camera-panel'

  // ──────────────────────────────────────────
  // 字幕の自動有効化
  // ──────────────────────────────────────────
  function enableCaptions() {
    const ccBtn = document.querySelector('button[aria-label*="Turn on captions"]')
      || document.querySelector('button[aria-label*="字幕をオン"]')
      || document.querySelector('button[aria-label*="字幕を表示"]')
    if (ccBtn) {
      LOG('字幕ボタンを自動クリック')
      ccBtn.click()
      return true
    }

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

  /**
   * 字幕コンテナを探す。見つかったらキャッシュする。
   */
  function findCaptionContainer() {
    if (captionContainer && document.contains(captionContainer)) {
      return captionContainer
    }
    captionContainer = null

    // 戦略 1: aria-live 要素で字幕テキストを含むもの
    const liveRegions = document.querySelectorAll('[aria-live]')
    for (const region of liveRegions) {
      // 自分の UI は除外
      if (region.closest(AIBA_SELECTOR)) continue
      // ボタンやツールバーは除外
      if (region.closest('[role="toolbar"]')) continue
      if (region.tagName === 'BUTTON') continue

      const text = region.textContent.trim()
      // 空でなく、短すぎず（UIラベル除外）、テキストがある
      if (text.length > 5 && !isUIText(text)) {
        LOG('字幕コンテナ発見 (aria-live):', region.getAttribute('aria-live'), region.tagName, region.className)
        captionContainer = region
        return region
      }
    }

    // 戦略 2: 既知の jsname セレクタ
    const knownSelectors = [
      'div[jsname="dsyhDe"]',   // 字幕親コンテナ
      'div[jsname="tgaKEf"]',   // 字幕コンテンツ
      'div[jsname="CCowhf"]',   // 字幕エリア
      'div[jsname="YSxPC"]',    // 字幕要素
    ]
    for (const sel of knownSelectors) {
      const el = document.querySelector(sel)
      if (el && el.textContent.trim().length > 0) {
        LOG('字幕コンテナ発見 (jsname):', sel)
        captionContainer = el
        return el
      }
    }

    return null
  }

  // ──────────────────────────────────────────
  // 字幕テキスト・話者名の抽出
  // ──────────────────────────────────────────

  /**
   * コンテナから字幕テキストと話者名を抽出する
   */
  function extractFromContainer(container) {
    if (!container) return null

    const text = container.textContent.trim()
    if (!text || text.length < 2) return null
    if (isUIText(text)) return null

    // 話者名の抽出
    let speaker = ''

    // 方法 1: .jxFHg クラス
    const jxEl = container.querySelector('.jxFHg')
    if (jxEl) {
      speaker = jxEl.textContent.trim()
    }

    // 方法 2: 太字要素を探す
    if (!speaker) {
      const boldEls = container.querySelectorAll('span, div')
      for (const el of boldEls) {
        if (el.children.length > 0) continue
        const s = el.textContent.trim()
        if (!s || s.length > 30) continue
        try {
          const style = window.getComputedStyle(el)
          if (parseInt(style.fontWeight) >= 500) {
            // 次の兄弟要素にテキストがあれば話者名と判定
            if (el.nextElementSibling || el.parentElement.textContent.length > s.length + 5) {
              speaker = s
              break
            }
          }
        } catch { /* ignore */ }
      }
    }

    // テキストから話者名を除去
    let captionText = text
    if (speaker && captionText.startsWith(speaker)) {
      captionText = captionText.substring(speaker.length).trim()
    }

    if (!captionText) return null

    return { speaker: speaker || '参加者', text: captionText }
  }

  /**
   * UIテキスト（マテリアルアイコン名、ボタンラベル等）を除外
   */
  function isUIText(text) {
    const t = text.trim()
    if (!t) return true
    // マテリアルアイコン名
    if (/^(arrow_|more_|close|check|search|menu|send|mic|videocam|present_to_all|pan_tool|emoji|call_end|screen_share|people|chat|info|settings|feedback)/.test(t)) return true
    // 「一番下に移動」などの UI ラベル
    if (/^一番下に移動/.test(t)) return true
    // 非常に短いテキスト（1文字）
    if (t.length <= 1) return true
    return false
  }

  // ──────────────────────────────────────────
  // 字幕処理
  // ──────────────────────────────────────────

  function processCaptions() {
    const container = findCaptionContainer()
    if (!container) return

    const result = extractFromContainer(container)
    if (!result) return

    const { speaker, text } = result

    // 前回と同じなら無視
    if (speaker === currentSpeaker && text === currentText) return

    const isNewSpeaker = speaker !== currentSpeaker

    // 前回の字幕を確定
    if (isNewSpeaker && currentText) {
      dispatchCaption(currentSpeaker, currentText, true)
    }

    currentSpeaker = speaker
    currentText = text

    // 暫定結果を送信
    dispatchCaption(speaker, text, false)
    resetFinalizeTimer()
  }

  // ──────────────────────────────────────────
  // 確定タイマー
  // ──────────────────────────────────────────
  function resetFinalizeTimer() {
    if (finalizeTimer) clearTimeout(finalizeTimer)
    finalizeTimer = setTimeout(() => {
      if (currentText) {
        dispatchCaption(currentSpeaker, currentText, true)
        currentSpeaker = ''
        currentText = ''
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
  // 監視
  // ──────────────────────────────────────────

  function startObserving() {
    if (isObserving) return

    // 方式 A: コンテナが見つかっている場合は直接監視
    const container = findCaptionContainer()
    if (container) {
      LOG('字幕コンテナを直接監視:', container.tagName, container.className)
      captionObserver = new MutationObserver(() => processCaptions())
      captionObserver.observe(container, {
        childList: true,
        subtree: true,
        characterData: true,
      })
    }

    // 方式 B: 定期スキャン（コンテナ未発見時のフォールバック + コンテナ再検出）
    scanInterval = setInterval(() => {
      // コンテナが消えた場合の再検出
      if (captionContainer && !document.contains(captionContainer)) {
        LOG('字幕コンテナが消失、再検出中...')
        captionContainer = null
        if (captionObserver) {
          captionObserver.disconnect()
          captionObserver = null
        }
      }

      // コンテナ未発見なら探す
      if (!captionContainer) {
        const found = findCaptionContainer()
        if (found) {
          LOG('字幕コンテナを再検出、監視再開')
          captionObserver = new MutationObserver(() => processCaptions())
          captionObserver.observe(found, {
            childList: true,
            subtree: true,
            characterData: true,
          })
        }
      }

      // 字幕処理
      processCaptions()
    }, 500)

    isObserving = true
    LOG('字幕監視を開始')
    document.dispatchEvent(new CustomEvent('aiba-captions-status', {
      detail: { status: 'active' },
    }))
  }

  function stopObserving() {
    if (captionObserver) {
      captionObserver.disconnect()
      captionObserver = null
    }
    if (scanInterval) {
      clearInterval(scanInterval)
      scanInterval = null
    }
    isObserving = false
    captionContainer = null
    currentSpeaker = ''
    currentText = ''
    LOG('字幕監視を停止')
  }

  // ──────────────────────────────────────────
  // デバッグ: DOM 構造のダンプ（コンソールから呼び出し可能）
  // ──────────────────────────────────────────
  window.__aibaDumpCaptions = function () {
    console.group('[Ai-Ba Captions Debug]')

    console.log('isCaptionsOn:', isCaptionsOn())

    // aria-live 要素
    const liveRegions = document.querySelectorAll('[aria-live]')
    console.log('aria-live 要素:', liveRegions.length)
    liveRegions.forEach((el, i) => {
      const text = el.textContent.trim().substring(0, 100)
      console.log(`  [${i}] ${el.tagName}.${el.className} aria-live="${el.getAttribute('aria-live')}" text="${text}"`)
    })

    // 既知の jsname
    const jsnames = ['dsyhDe', 'tgaKEf', 'CCowhf', 'YSxPC']
    for (const name of jsnames) {
      const el = document.querySelector(`[jsname="${name}"]`)
      if (el) {
        console.log(`jsname="${name}": found`, el.tagName, el.className, 'text:', el.textContent.trim().substring(0, 100))
      }
    }

    // 現在のコンテナ
    console.log('現在のコンテナ:', captionContainer)
    console.log('isObserving:', isObserving)

    console.groupEnd()
  }

  // ──────────────────────────────────────────
  // 初期化
  // ──────────────────────────────────────────
  function init() {
    LOG('初期化開始 (v3: 複合戦略)')

    const waitAndStart = () => {
      if (!document.body) {
        requestAnimationFrame(waitAndStart)
        return
      }

      // 字幕が OFF なら ON にする（5秒後、Meet UI 安定後）
      setTimeout(() => {
        if (!isCaptionsOn()) {
          LOG('字幕を自動 ON に試行...')
          enableCaptions()
        }
      }, 5000)

      // 監視開始（字幕がまだ表示されていなくても開始）
      setTimeout(() => {
        startObserving()

        // 10秒後にコンテナが見つかっていなければログ
        setTimeout(() => {
          if (!captionContainer) {
            LOG('⚠ 字幕コンテナが見つかりません。コンソールで __aibaDumpCaptions() を実行してDOMを確認してください。')
          }
        }, 10000)
      }, 3000)
    }

    waitAndStart()
  }

  // ── 外部からの制御 ──
  document.addEventListener('aiba-captions-control', (e) => {
    if (e.detail?.action === 'start') {
      if (!isCaptionsOn()) enableCaptions()
      if (!isObserving) startObserving()
    }
    if (e.detail?.action === 'stop') {
      stopObserving()
    }
  })

  init()
  LOG('Google Meet 字幕スクレイパー v3 読み込み完了')
})()
