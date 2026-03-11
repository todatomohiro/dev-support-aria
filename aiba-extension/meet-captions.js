/**
 * Ai-Ba Tools — Google Meet 字幕受信 (v15: messageId ベースの重複排除)
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
 *
 * 字幕の確定ロジック（v15 改善）:
 *   - messageId + messageVersion で同一発話を追跡
 *   - 同じ messageId の新バージョンが来たら interim/確定済みを更新
 *   - 500ms ごとにバッチ処理（Tactiq 方式）
 *   - 新しい messageId が来た or 3秒経過で前のメッセージを確定
 */
;(function () {
  'use strict'

  if (window.__aibaCaptionsInjected) return
  window.__aibaCaptionsInjected = true

  const LOG = (...args) => console.log('[Ai-Ba Captions]', ...args)

  // ──────────────────────────────────────────
  // 状態
  // ──────────────────────────────────────────
  let captionReceived = false

  /** deviceId → deviceName のマッピング */
  const deviceNames = new Map()

  /**
   * アクティブなメッセージバッファ
   * messageId → { deviceId, text, messageVersion, speaker, updatedAt }
   */
  const activeMessages = new Map()

  /** 確定済みとして dispatch 済みの messageId セット（更新検出用） */
  const finalizedMessages = new Map() // messageId → { text }

  /** バッチ処理タイマー */
  let batchTimer = null
  const BATCH_INTERVAL = 500  // 500ms ごとにバッチ処理
  const FINALIZE_TIMEOUT = 3000  // 3秒更新なしで確定

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

    const { deviceId, text, messageId, messageVersion } = event.data
    if (!text) return

    // 初回受信時にステータスを通知
    if (!captionReceived) {
      captionReceived = true
      LOG('★ 字幕データ受信開始（RTC データチャネル経由）')
      document.dispatchEvent(new CustomEvent('aiba-captions-status', {
        detail: { status: 'active' },
      }))
    }

    // メッセージをバッファに追加/更新
    const key = messageId != null ? `${deviceId}:${messageId}` : `${deviceId}:${Date.now()}`
    const existing = activeMessages.get(key)

    if (existing && messageVersion <= existing.messageVersion) {
      // 古いバージョンはスキップ
      return
    }

    const speaker = deviceNames.get(deviceId) || '参加者'

    activeMessages.set(key, {
      deviceId,
      text,
      messageVersion: messageVersion || 0,
      speaker,
      updatedAt: Date.now(),
    })

    // 確定済みエントリの更新チェック
    const finalized = finalizedMessages.get(key)
    if (finalized && finalized.text !== text) {
      // 確定済みだがテキストが変わった → 更新イベントを dispatch
      finalizedMessages.set(key, { text })
      dispatchCaption(speaker, text, true, key, 'update')
      activeMessages.delete(key)
      return
    }

    // interim を即時 dispatch（UI のリアルタイム表示用）
    dispatchCaption(speaker, text, false, key)

    // バッチ処理タイマーを開始
    ensureBatchTimer()
  })

  // ──────────────────────────────────────────
  // バッチ処理: 確定判定
  // ──────────────────────────────────────────
  function ensureBatchTimer() {
    if (batchTimer) return
    batchTimer = setInterval(processBatch, BATCH_INTERVAL)
  }

  function processBatch() {
    const now = Date.now()
    const toFinalize = []

    for (const [key, msg] of activeMessages) {
      const elapsed = now - msg.updatedAt

      if (elapsed >= FINALIZE_TIMEOUT) {
        // 3秒更新なし → 確定
        toFinalize.push({ key, msg })
      }
    }

    for (const { key, msg } of toFinalize) {
      activeMessages.delete(key)
      finalizedMessages.set(key, { text: msg.text })
      dispatchCaption(msg.speaker, msg.text, true, key)
    }

    // 古い確定済みメッセージのクリーンアップ（1000件超えたら半分削除）
    if (finalizedMessages.size > 1000) {
      const keys = [...finalizedMessages.keys()]
      for (let i = 0; i < 500; i++) {
        finalizedMessages.delete(keys[i])
      }
    }

    // アクティブなメッセージがなくなったらタイマー停止
    if (activeMessages.size === 0) {
      clearInterval(batchTimer)
      batchTimer = null
    }
  }

  // ──────────────────────────────────────────
  // tool-noter.js への転送
  // ──────────────────────────────────────────
  function dispatchCaption(speaker, text, isFinal, messageKey, action) {
    document.dispatchEvent(new CustomEvent('aiba-caption', {
      detail: {
        speaker,
        text,
        isFinal,
        timestamp: Date.now(),
        messageKey,
        // action: 'update' の場合、確定済みエントリのテキスト更新
        ...(action && { action }),
      },
    }))
  }

  // ──────────────────────────────────────────
  // 初期化
  // ──────────────────────────────────────────
  LOG('初期化 (v15: messageId ベースの重複排除)')

  setTimeout(() => {
    document.dispatchEvent(new CustomEvent('aiba-captions-status', {
      detail: { status: captionReceived ? 'active' : 'waiting' },
    }))
  }, 3000)
})()
