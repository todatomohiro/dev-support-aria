/**
 * Ai-Ba Tools — Google Meet 字幕スクレイパー (v2)
 *
 * Google Meet の字幕（Captions）をリアルタイムで取得する。
 *
 * 方式: document.body 全体を MutationObserver で監視し、
 * 字幕テキストの変更（characterData）を検出する。
 * 字幕 OFF の場合は自動で ON にする。
 */
;(function () {
  'use strict'

  if (window.__aibaCaptionsInjected) return
  window.__aibaCaptionsInjected = true

  const LOG = (...args) => console.log('[Ai-Ba Captions]', ...args)

  // ──────────────────────────────────────────
  // 状態
  // ──────────────────────────────────────────
  let isObserving = false
  let bodyObserver = null

  // 字幕の蓄積（話者ごと）
  let currentSpeaker = ''
  let currentText = ''
  let finalizeTimer = null

  // 拡張機能自身のUI要素を除外するための ID リスト
  const AIBA_IDS = ['aiba-toolbar', 'aiba-noter-panel', 'aiba-camera-panel']

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
  // 字幕要素の判定
  // ──────────────────────────────────────────

  /**
   * 要素が拡張機能自身の UI かどうか
   */
  function isOwnUI(el) {
    for (const id of AIBA_IDS) {
      if (el.closest(`#${id}`)) return true
    }
    return false
  }

  /**
   * 要素が字幕表示エリアの一部かどうかを判定する。
   *
   * Google Meet の字幕は以下の特徴を持つ:
   * - 画面下部に表示される
   * - position: absolute/fixed で重ねて表示
   * - 背景が暗い（半透明黒）
   * - フォントが比較的大きい
   * - 短い行（1〜2行）
   */
  function isCaptionElement(el) {
    if (!el || !el.parentElement) return false

    // 拡張機能自身のUIは除外
    if (isOwnUI(el)) return false

    // 字幕テキストは通常 span 内にある
    // 親要素のスタイルをチェック
    const container = findCaptionAncestor(el)
    return container !== null
  }

  /**
   * 字幕コンテナ（字幕エントリの親）を探す。
   * 字幕は通常 2〜3 段のネストで表示される。
   */
  function findCaptionAncestor(el) {
    let node = el
    // 最大 8 段まで遡る
    for (let i = 0; i < 8; i++) {
      if (!node || node === document.body) break

      const style = window.getComputedStyle(node)

      // 字幕コンテナの特徴: 画面下部に固定/絶対配置
      const pos = style.position
      if ((pos === 'absolute' || pos === 'fixed') && node.offsetHeight > 0) {
        const rect = node.getBoundingClientRect()
        const viewportHeight = window.innerHeight

        // 画面下半分にある
        if (rect.top > viewportHeight * 0.5) {
          // 背景色チェック（暗い背景）
          const bg = style.backgroundColor
          if (isDarkBackground(bg)) {
            return node
          }
        }
      }
      node = node.parentElement
    }
    return null
  }

  /**
   * 背景色が暗い（字幕背景の半透明黒等）かを判定
   */
  function isDarkBackground(bg) {
    if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return false
    // rgba(0, 0, 0, 0.x) パターン
    const rgba = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    if (rgba) {
      const r = parseInt(rgba[1])
      const g = parseInt(rgba[2])
      const b = parseInt(rgba[3])
      // 暗い色（R+G+B < 150）
      return (r + g + b) < 150
    }
    return false
  }

  // ──────────────────────────────────────────
  // 話者名の抽出
  // ──────────────────────────────────────────
  function extractSpeakerFromCaption(el) {
    if (!el) return ''

    // 字幕エントリを遡って話者名を探す
    let node = el
    for (let i = 0; i < 6; i++) {
      if (!node || node === document.body) break

      // 兄弟要素として話者名がある場合
      const prev = node.previousElementSibling
      if (prev) {
        const text = prev.textContent.trim()
        // 話者名の特徴: 短い文字列（20文字以内）、改行なし
        if (text && text.length <= 30 && !text.includes('\n')) {
          // Google のマテリアルアイコン名は除外
          if (!/^(arrow_|more_|close|check|search|menu|add)/.test(text)) {
            return text
          }
        }
      }

      // 子要素に .jxFHg クラスがある場合
      const speakerEl = node.querySelector('.jxFHg')
      if (speakerEl) {
        return speakerEl.textContent.trim()
      }

      node = node.parentElement
    }

    return ''
  }

  // ──────────────────────────────────────────
  // MutationObserver: body 全体の変更を監視
  // ──────────────────────────────────────────
  function onMutation(mutations) {
    for (const mutation of mutations) {
      // characterData: テキストの変更（字幕のリアルタイム更新）
      if (mutation.type === 'characterData') {
        const textNode = mutation.target
        const parentEl = textNode.parentElement
        if (parentEl && isCaptionElement(parentEl)) {
          handleCaptionUpdate(parentEl)
        }
        continue
      }

      // childList: 新しい字幕ノードの追加
      if (mutation.type === 'childList') {
        for (const added of mutation.addedNodes) {
          if (added instanceof HTMLElement && isCaptionElement(added)) {
            handleCaptionUpdate(added)
          }
        }
      }
    }
  }

  /**
   * 字幕更新を処理する
   */
  function handleCaptionUpdate(el) {
    // 字幕コンテナを見つけてテキスト全体を取得
    const container = findCaptionAncestor(el)
    if (!container) return

    // コンテナ内の全テキストを取得
    const fullText = container.textContent.trim()
    if (!fullText) return

    // 話者名を抽出
    const speaker = extractSpeaker(container) || '参加者'
    const text = removeSpeakerPrefix(fullText, speaker)

    if (!text) return

    // ノイズフィルタ: UIテキストを除外
    if (isUIText(text)) return

    // 前回と同じなら無視
    if (speaker === currentSpeaker && text === currentText) return

    const isNewSpeaker = speaker !== currentSpeaker
    const isExtension = !isNewSpeaker && currentText && text.startsWith(currentText)

    if (isNewSpeaker && currentText) {
      // 前回の字幕を確定
      dispatchCaption(currentSpeaker, currentText, true)
    }

    currentSpeaker = speaker
    currentText = text

    // 暫定結果を送信
    dispatchCaption(speaker, text, false)

    // 確定タイマーリセット
    resetFinalizeTimer()
  }

  /**
   * コンテナから話者名を抽出する
   */
  function extractSpeaker(container) {
    // 方法1: .jxFHg クラス
    const jx = container.querySelector('.jxFHg')
    if (jx) return jx.textContent.trim()

    // 方法2: コンテナ内の最初の短いテキスト要素
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT)
    let node
    while ((node = walker.nextNode())) {
      if (node.children.length === 0) {
        const text = node.textContent.trim()
        // 話者名の特徴: 短く、直後にテキストが続く
        if (text && text.length <= 30 && node.nextElementSibling) {
          const style = window.getComputedStyle(node)
          // 話者名は通常太字
          if (style.fontWeight >= 500 || style.fontWeight === 'bold') {
            return text
          }
        }
      }
    }

    return ''
  }

  /**
   * テキストから話者名プレフィックスを除去
   */
  function removeSpeakerPrefix(text, speaker) {
    if (speaker && text.startsWith(speaker)) {
      return text.substring(speaker.length).trim()
    }
    return text
  }

  /**
   * UIテキスト（ボタン、ラベル等）を除外
   */
  function isUIText(text) {
    const uiPatterns = [
      /^arrow_/,
      /^一番下に移動/,
      /^close$/,
      /^more_/,
      /^check$/,
      /^search$/,
      /^menu$/,
      /^send$/,
      /^mic/,
      /^videocam/,
      /^present_to_all/,
      /^pan_tool/,
      /^emoji/,
    ]
    return uiPatterns.some((p) => p.test(text.trim()))
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
  // 監視の開始/停止
  // ──────────────────────────────────────────
  function startObserving() {
    if (isObserving) return

    bodyObserver = new MutationObserver(onMutation)
    bodyObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    isObserving = true
    LOG('body 全体の字幕監視を開始')
    document.dispatchEvent(new CustomEvent('aiba-captions-status', {
      detail: { status: 'active' },
    }))
  }

  function stopObserving() {
    if (bodyObserver) {
      bodyObserver.disconnect()
      bodyObserver = null
    }
    isObserving = false
    currentSpeaker = ''
    currentText = ''
    LOG('字幕監視を停止')
  }

  // ──────────────────────────────────────────
  // 初期化
  // ──────────────────────────────────────────
  function init() {
    LOG('初期化開始 (v2: body 全体監視)')

    // 会議画面が準備できるまで待つ
    const waitAndStart = () => {
      if (!document.body) {
        requestAnimationFrame(waitAndStart)
        return
      }

      // 字幕が OFF なら ON にする（3秒後、UI安定後に）
      setTimeout(() => {
        if (!isCaptionsOn()) {
          enableCaptions()
          // ON にした後、少し待ってから再チェック
          setTimeout(() => {
            if (!isCaptionsOn()) {
              LOG('字幕を自動 ON にできませんでした。手動で ON にしてください。')
            }
          }, 2000)
        }
      }, 3000)

      // 字幕の有無に関わらず body 監視を開始
      startObserving()
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
  LOG('Google Meet 字幕スクレイパー v2 読み込み完了')
})()
