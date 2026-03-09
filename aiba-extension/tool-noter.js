/**
 * Ai-Ba Tools — Meeting Noter ツール（v14: collections チャネルから話者名取得）
 *
 * - 自分・参加者の音声: Meet RTC データチャネルの字幕で統一取得
 * - 話者名: collections チャネルの Protobuf から deviceId → deviceName を取得
 * - 録音開始時にミーティングセッションを自動作成（DynamoDB 保存）
 * - URL 変更で新しいセッション作成
 * - Ai-Ba アプリ連携: トピック自動作成 + リアルタイムストリーミング
 */
;(function () {
  'use strict'

  if (window.__aibaNoterInjected) return
  window.__aibaNoterInjected = true

  const LOG = (...args) => console.log('[Ai-Ba Noter]', ...args)
  const tools = window.__aibaTools

  // ──────────────────────────────────────────
  // 設定（デプロイ後に Meeting Noter Lambda URL を設定）
  // ──────────────────────────────────────────
  const NOTER_API_URL = 'https://r66runuxxzinsdo7ojuv2zhqcm0foznc.lambda-url.ap-northeast-1.on.aws/'

  // ──────────────────────────────────────────
  // 状態
  // ──────────────────────────────────────────
  let isTranscribing = false     // 文字起こし全体の ON/OFF
  let captionEnabled = true      // RTC 字幕を受信するか（isTranscribing と連動）
  let captionDataActive = false  // 実際に字幕データが流れているか
  const transcripts = []

  // セッション管理
  let currentMeetingId = null
  let currentSessionTitle = null
  let pendingEntries = [] // 未送信の文字起こし
  let flushTimer = null

  // Ai-Ba トピック連携
  let linkedThemeId = null  // 自動作成されたトピック ID
  let streamBatchTimer = null // 字幕ストリーミング用バッチタイマー
  let streamBatchEntries = [] // ストリーミング用バッファ
  const STREAM_INTERVAL = 30000 // 30秒ごとにバッチ送信

  // Ai-Ba 認証
  let aibaToken = null
  let aibaUserId = null
  let aibaApiUrl = null

  // 起動時に chrome.storage からトークン読み込み
  chrome.storage.local.get(['aibaToken', 'aibaUserId', 'aibaApiUrl'], (data) => {
    if (data.aibaToken) {
      aibaToken = data.aibaToken
      aibaUserId = data.aibaUserId
      aibaApiUrl = data.aibaApiUrl
      LOG('Ai-Ba 認証トークン読み込み済み')
      updateSaveTopicBtn()
    }
  })

  // popup からの認証更新通知
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'aiba-auth-updated') {
      aibaToken = message.token
      aibaUserId = message.userId
      aibaApiUrl = message.apiUrl
      LOG('Ai-Ba 認証トークン更新')
      updateSaveTopicBtn()
    }
  })

  /**
   * background service worker 経由で fetch する（CORS 回避）。
   * content script からの直接 fetch はページオリジンで送信されるため CORS エラーになる。
   */
  async function apiFetch(url, options) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'aiba-api-proxy', url, options }, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        if (!res || res.error) {
          reject(new Error(res?.error || 'API proxy error'))
          return
        }
        resolve(res)
      })
    })
  }

  // ──────────────────────────────────────────
  // ミーティング ID 抽出
  // ──────────────────────────────────────────
  function extractMeetingId() {
    const url = location.href
    // Google Meet: https://meet.google.com/xxx-xxxx-xxx
    const meetMatch = url.match(/meet\.google\.com\/([a-z\-]+)/)
    if (meetMatch) return `meet-${meetMatch[1]}`
    // Zoom: https://xxx.zoom.us/j/12345678
    const zoomMatch = url.match(/zoom\.us\/j\/(\d+)/)
    if (zoomMatch) return `zoom-${zoomMatch[1]}`
    // Teams: https://teams.microsoft.com/...meetingId=xxx
    const teamsMatch = url.match(/teams\.microsoft\.com.*[?&]meetingId=([^&]+)/)
    if (teamsMatch) return `teams-${teamsMatch[1]}`
    // フォールバック: ホスト + パス
    return `meeting-${location.hostname}-${location.pathname.replace(/\//g, '-')}`
  }

  // ──────────────────────────────────────────
  // セッション管理
  // ──────────────────────────────────────────
  async function ensureSession() {
    const meetingId = extractMeetingId()

    // 同じミーティングなら既存セッションを使用
    if (currentMeetingId === meetingId) return

    LOG('新しいミーティングセッション:', meetingId)
    currentMeetingId = meetingId

    if (!NOTER_API_URL) {
      currentSessionTitle = `Meeting (ローカル)`
      updateSessionUI()
      return
    }

    try {
      LOG('セッション作成 fetch:', NOTER_API_URL, meetingId)
      const res = await fetch(NOTER_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          meetingId,
          meetingUrl: location.href,
        }),
      })
      LOG('セッション作成 レスポンス:', res.status)
      const data = await res.json()
      currentSessionTitle = data.title
      LOG(data.resumed ? 'セッション再開:' : 'セッション作成:', data.title)
      updateSessionUI()
      tools.toast(`セッション: ${data.title}`)
    } catch (err) {
      LOG('セッション作成エラー:', err.message, err)
      currentSessionTitle = 'Meeting (オフライン)'
      updateSessionUI()
    }
  }

  function updateSessionUI() {
    const header = document.querySelector('#aiba-noter-panel .ap-header h3')
    if (header && currentSessionTitle) {
      header.textContent = currentSessionTitle
      header.title = currentSessionTitle
    }
  }

  /** 文字起こしをバッチでサーバーに送信 */
  function queueTranscriptSync(entry) {
    if (!NOTER_API_URL || !currentMeetingId) return
    pendingEntries.push(entry)

    // 5秒ごとにバッチ送信
    if (!flushTimer) {
      flushTimer = setTimeout(flushPendingEntries, 5000)
    }
  }

  async function flushPendingEntries() {
    flushTimer = null
    if (pendingEntries.length === 0 || !currentMeetingId) return

    const entries = [...pendingEntries]
    pendingEntries = []

    try {
      await fetch(NOTER_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'transcript',
          meetingId: currentMeetingId,
          entries,
        }),
      })
      LOG(`文字起こし ${entries.length} 件をサーバーに保存`)
    } catch (err) {
      LOG('文字起こし保存エラー:', err)
      // 失敗した分を戻す
      pendingEntries.unshift(...entries)
    }
  }

  // ──────────────────────────────────────────
  // パネル作成
  // ──────────────────────────────────────────
  function createNoterPanel() {
    const panel = document.createElement('div')
    panel.id = 'aiba-noter-panel'
    panel.className = 'aiba-panel'
    panel.innerHTML = `
      <div class="ap-header">
        <div class="ap-header-left">
          <div class="an-status-dot" id="anStatusDot"></div>
          <h3>Meeting Noter</h3>
        </div>
        <button class="ap-close" id="aibaNoterClose">&times;</button>
      </div>
      <div class="an-transcript" id="anTranscript">
        <div class="an-empty" id="anEmpty">
          <div class="an-empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></div>
          <p>「文字起こし開始」を押すと<br>Meet の字幕を取得します</p>
        </div>
      </div>
      <div class="an-toolbar" id="anToolbar">
        <div style="display:flex;flex-direction:column;gap:6px;flex:1;">
          <div class="an-main-controls">
            <button class="an-main-toggle" id="anMainToggle">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              <span id="anMainToggleLabel">文字起こし開始</span>
            </button>
            <span class="an-main-status" id="anMainStatus"></span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span class="an-count" id="anCount">0 件</span>
            <div style="display:flex;gap:4px;">
              <button class="an-small-btn" id="anSaveTopicBtn" style="background:#059669;color:#fff;display:none;">トピック保存</button>
              <button class="an-small-btn" id="anCopyBtn">コピー</button>
              <button class="an-small-btn" id="anClearBtn">クリア</button>
            </div>
          </div>
        </div>
      </div>
    `

    const mount = () => {
      if (document.body) {
        document.body.appendChild(panel)
        initNoterEvents(panel)
        tools.makeDraggable(panel)
      } else {
        requestAnimationFrame(mount)
      }
    }
    mount()
  }

  // ──────────────────────────────────────────
  // パネルイベント
  // ──────────────────────────────────────────
  function initNoterEvents(panel) {
    panel.querySelector('#aibaNoterClose').addEventListener('click', () => {
      tools.togglePanel('aiba-noter-panel', 'aiba-btn-noter')
    })

    panel.querySelector('#anMainToggle').addEventListener('click', toggleTranscription)

    // 起動時にタブキャプチャ状態を確認
    chrome.runtime.sendMessage({ type: 'get-capture-status' }, (res) => {
      void chrome.runtime.lastError
      if (res?.isCapturing) {
        captionDataActive = true
        updateRecUI()
      }
    })

    // 認証済みなら「トピック保存」ボタンを表示
    updateSaveTopicBtn()

    // トピック保存
    panel.querySelector('#anSaveTopicBtn').addEventListener('click', saveToTopic)

    // コピー
    panel.querySelector('#anCopyBtn').addEventListener('click', () => {
      const text = transcripts
        .map((t) => {
          const time = fmtTime(t.timestamp)
          return `[${time}] [${t.speaker}] ${t.text}`
        })
        .join('\n')
      navigator.clipboard.writeText(text).then(() => {
        const btn = panel.querySelector('#anCopyBtn')
        btn.textContent = 'OK'
        setTimeout(() => { btn.textContent = 'コピー' }, 1500)
      })
    })

    // クリア
    panel.querySelector('#anClearBtn').addEventListener('click', () => {
      if (transcripts.length === 0) return
      if (!confirm('文字起こしをクリアしますか？')) return
      transcripts.length = 0
      const tp = panel.querySelector('#anTranscript')
      tp.innerHTML = '<div class="an-empty" id="anEmpty"><div class="an-empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></div><p>「文字起こし開始」を押すと<br>Meet の字幕を取得します</p></div>'
      panel.querySelector('#anCount').textContent = '0 件'
      updateNoterBadge()
    })

  }

  // ──────────────────────────────────────────
  // 文字起こし統合トグル
  // ──────────────────────────────────────────
  async function toggleTranscription() {
    if (isTranscribing) {
      // 停止
      isTranscribing = false
      captionEnabled = false
      stopStreamBatch()
      updateRecUI()
      LOG('文字起こし終了')

      // 残りのバッチをフラッシュしてから自動保存 → 会議終了通知
      flushStreamBatch().then(() => autoSaveToTopic()).then(() => notifyMeetingEnded())
    } else {
      // 開始
      isTranscribing = true
      captionEnabled = true
      await ensureSession()
      updateRecUI()
      LOG('文字起こし開始')

      // Ai-Ba にプライベートトピックを自動作成 → 成功したらストリーミング開始
      autoCreateTopic().then(() => {
        if (linkedThemeId) startStreamBatch()
      })
    }
  }

  // デバイス情報受信（collections チャネルから話者名取得）
  document.addEventListener('aiba-deviceinfo', (e) => {
    const { deviceId, deviceName } = e.detail || {}
    if (deviceId && deviceName) {
      LOG(`話者名取得: ${deviceId} → "${deviceName}"`)
    }
  })

  /**
   * 文字起こし開始時にプライベートトピックを自動作成する。
   * トークンがなければスキップ（手動のトピック保存ボタンで後から可能）。
   */
  async function autoCreateTopic() {
    if (!aibaToken || !aibaApiUrl) {
      LOG('Ai-Ba 未連携 — トピック自動作成スキップ')
      return
    }

    // 既にこの会議用のトピックがある場合はスキップ
    if (linkedThemeId) return

    const now = new Date()
    const dateStr = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const meetingTitle = currentSessionTitle || `Meeting`
    const themeName = `${meetingTitle} — ${dateStr}`

    try {
      const res = await apiFetch(`${aibaApiUrl}/themes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aibaToken}`,
        },
        body: JSON.stringify({ themeName, isPrivate: true }),
      })

      if (!res.ok) {
        LOG('トピック自動作成失敗:', res.status, res.body)
        return
      }

      const data = JSON.parse(res.body)
      linkedThemeId = data.themeId
      LOG('トピック自動作成完了:', themeName, linkedThemeId)
      updateSaveTopicBtn()

      // アプリに会議開始通知を送信（WebSocket 経由でトピック自動オープン）
      notifyMeetingStarted(linkedThemeId, themeName)
    } catch (err) {
      LOG('トピック自動作成エラー:', err.message)
    }
  }

  /**
   * アプリに会議開始を通知する（POST /meeting/transcript に action='meeting_started'）。
   * アプリ側で WebSocket 経由でトピックが自動オープンされる。
   */
  async function notifyMeetingStarted(themeId, themeName) {
    if (!aibaToken || !aibaApiUrl) return
    try {
      await apiFetch(`${aibaApiUrl}/meeting/transcript`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aibaToken}`,
        },
        body: JSON.stringify({ action: 'meeting_started', themeId, themeName }),
      })
      LOG('会議開始通知送信完了')
    } catch (err) {
      LOG('会議開始通知エラー:', err.message)
    }
  }

  /**
   * アプリに会議終了を通知する（WebSocket 経由で UI 更新）。
   */
  async function notifyMeetingEnded() {
    if (!linkedThemeId || !aibaToken || !aibaApiUrl) return
    try {
      await apiFetch(`${aibaApiUrl}/meeting/transcript`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aibaToken}`,
        },
        body: JSON.stringify({
          action: 'meeting_ended',
          themeId: linkedThemeId,
          totalEntries: transcripts.length,
        }),
      })
      LOG('会議終了通知送信完了')
    } catch (err) {
      LOG('会議終了通知エラー:', err.message)
    }
  }

  /**
   * 文字起こし終了時にトピックへ自動保存する。
   * linkedThemeId がない場合は何もしない。
   */
  async function autoSaveToTopic() {
    if (!linkedThemeId || !aibaToken || !aibaApiUrl) return
    if (transcripts.length === 0) return

    const themeId = linkedThemeId

    try {
      await flushPendingEntries()

      const transcriptText = transcripts
        .map((t) => {
          const time = fmtTime(t.timestamp)
          return `[${time}] [${t.speaker}] ${t.text}`
        })
        .join('\n')

      const themeName = currentSessionTitle || 'Meeting'
      LOG('トピック自動保存:', themeId, `${transcripts.length}件`)

      const res = await apiFetch(`${aibaApiUrl}/llm/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aibaToken}`,
        },
        body: JSON.stringify({
          message: `以下は会議「${themeName}」の文字起こしです。内容を確認して、要約・要点・決定事項・TODOをまとめてください。\n\n${transcriptText}`,
          sessionId: themeId,
          themeId,
        }),
      })

      if (res.ok) {
        tools.toast('会議メモをトピックに保存しました')
        LOG('トピック自動保存完了')
      } else {
        LOG('トピック自動保存: AI要約エラー (トピックは作成済み)', res.status)
        tools.toast('会議メモを保存しました（要約は後で実行してください）')
      }
    } catch (err) {
      LOG('トピック自動保存エラー:', err.message)
      tools.toast('自動保存に失敗しました。手動で「トピック保存」してください')
    }
  }

  // ──────────────────────────────────────────
  // ──────────────────────────────────────────
  // RTC キャプション受信
  // ──────────────────────────────────────────
  // meet-captions.js が RTC データチャネルを監視し、
  // speaker=実名 or "参加者" で CustomEvent を転送してくる。

  document.addEventListener('aiba-caption', (e) => {
    if (!captionEnabled) return
    const { speaker, text, isFinal, timestamp } = e.detail

    if (isFinal) {
      addTranscript(speaker, text, timestamp, 'caption')
      removeInterim('caption')
    } else {
      updateInterim(`${speaker}: ${text}`, 'caption')
    }
  })

  document.addEventListener('aiba-captions-status', (e) => {
    const { status } = e.detail
    if (status === 'active') {
      captionDataActive = true
      ensureSession()
      updateRecUI()
      LOG('字幕受信開始')
    } else if (status === 'unavailable' || status === 'waiting') {
      updateRecUI()
    }
  })

  // background → content script へのメッセージ受信（tabCapture フォールバック）
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'tab-transcript') {
      if (!captionEnabled) return
      if (message.isFinal) {
        addTranscript('参加者', message.text, message.timestamp, 'tab-audio')
        removeInterim('tab')
      } else {
        updateInterim(message.text, 'tab')
      }
    }

    if (message.type === 'tab-capture-status') {
      if (message.status === 'active') {
        captionDataActive = true
        ensureSession()
        updateRecUI()
      } else if (message.status === 'error') {
        tools.toast(`参加者音声: ${message.error}`)
        captionDataActive = false
        updateRecUI()
      } else if (message.status === 'stopped') {
        captionDataActive = false
        updateRecUI()
      }
    }
  })

  // ──────────────────────────────────────────
  // UI 更新
  // ──────────────────────────────────────────
  function updateRecUI() {
    const dot = document.querySelector('#anStatusDot')
    const mainToggle = document.querySelector('#anMainToggle')
    const mainLabel = document.querySelector('#anMainToggleLabel')
    const mainStatus = document.querySelector('#anMainStatus')
    const active = isTranscribing && captionDataActive

    // メインボタン
    if (mainToggle) {
      if (isTranscribing) {
        mainToggle.classList.add('active')
        mainToggle.title = '文字起こし終了'
      } else {
        mainToggle.classList.remove('active')
        mainToggle.title = '文字起こし開始'
      }
    }
    if (mainLabel) {
      mainLabel.textContent = isTranscribing ? '文字起こし終了' : '文字起こし開始'
    }

    // ステータス
    if (mainStatus) {
      if (!isTranscribing) {
        mainStatus.textContent = ''
      } else if (!captionDataActive) {
        mainStatus.textContent = '字幕待機中'
      } else {
        mainStatus.textContent = '字幕受信中'
      }
    }

    // ヘッダーのステータスドット
    if (dot) {
      if (active) {
        dot.classList.add('connected')
      } else {
        dot.classList.remove('connected')
      }
    }
  }

  // ──────────────────────────────────────────
  // 暫定結果のリアルタイム表示
  // ──────────────────────────────────────────
  function updateInterim(text, source) {
    const tp = document.querySelector('#anTranscript')
    if (!tp) return
    const empty = tp.querySelector('#anEmpty')
    if (empty) empty.style.display = 'none'

    const cls = `an-interim an-interim-${source}`
    let interim = tp.querySelector(`.an-interim-${source}`)
    if (!interim) {
      interim = document.createElement('div')
      interim.className = `an-entry ${cls}`
      tp.appendChild(interim)
    }

    interim.innerHTML = `<div class="an-entry-speaker" style="color:#60a5fa"></div>`
      + `<div class="an-entry-text" style="color:#9ca3af;font-style:italic;">${tools.escHtml(text)}</div>`
    tp.scrollTop = tp.scrollHeight
  }

  function removeInterim(source) {
    const el = document.querySelector(`#anTranscript .an-interim-${source}`)
    if (el) el.remove()
  }

  // ──────────────────────────────────────────
  // 文字起こし表示 + サーバー保存
  // ──────────────────────────────────────────
  function fmtTime(ts) {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  }

  function addTranscript(speaker, text, timestamp, source) {
    const panel = document.getElementById('aiba-noter-panel')
    if (!panel) return
    const tp = panel.querySelector('#anTranscript')
    const empty = panel.querySelector('#anEmpty')

    const entry = { speaker, text, timestamp, source }
    transcripts.push(entry)

    const el = document.createElement('div')
    el.className = 'an-entry'
    el.dataset.idx = transcripts.length - 1
    el.innerHTML = entryHTML(entry)
    tp.appendChild(el)

    tp.scrollTop = tp.scrollHeight
    if (empty) empty.style.display = 'none'
    panel.querySelector('#anCount').textContent = `${transcripts.length} 件`
    updateNoterBadge()

    // サーバーに非同期保存
    queueTranscriptSync(entry)

    // リアルタイムストリーミング用バッファに追加
    if (linkedThemeId && aibaToken) {
      streamBatchEntries.push(entry)
    }
  }

  /** 話者名からユニークな色を生成（HSL ベース） */
  const speakerColors = new Map()
  const COLOR_PALETTE = ['#a78bfa', '#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#fb923c', '#a3e635', '#38bdf8']
  let colorIndex = 0
  function getSpeakerColor(name) {
    if (!speakerColors.has(name)) {
      speakerColors.set(name, COLOR_PALETTE[colorIndex % COLOR_PALETTE.length])
      colorIndex++
    }
    return speakerColors.get(name)
  }

  function entryHTML(entry) {
    const color = getSpeakerColor(entry.speaker)
    return `<span class="an-entry-time">${fmtTime(entry.timestamp)}</span>`
      + `<div class="an-entry-speaker" style="color:${color}">${tools.escHtml(entry.speaker)}</div>`
      + `<div class="an-entry-text">${tools.escHtml(entry.text)}</div>`
  }

  function updateNoterBadge() {
    const btn = document.getElementById('aiba-btn-noter')
    if (!btn) return
    let badge = btn.querySelector('.aiba-badge')
    if (transcripts.length > 0) {
      if (!badge) {
        badge = document.createElement('div')
        badge.className = 'aiba-badge'
        btn.appendChild(badge)
      }
    } else if (badge) {
      badge.remove()
    }
  }

  // ──────────────────────────────────────────
  // Ai-Ba トピック保存
  // ──────────────────────────────────────────
  function updateSaveTopicBtn() {
    const btn = document.querySelector('#anSaveTopicBtn')
    if (!btn) return

    if (!aibaToken) {
      btn.style.display = 'none'
      return
    }

    // 自動作成済みトピックがある場合はボタンを非表示（自動保存で処理済み）
    if (linkedThemeId) {
      btn.style.display = ''
      btn.textContent = '連携中'
      btn.disabled = true
      btn.style.background = '#475569'
      return
    }

    btn.style.display = ''
    btn.textContent = 'トピック保存'
    btn.disabled = false
    btn.style.background = '#059669'
  }

  /**
   * 手動トピック保存。
   * linkedThemeId がある場合はそのトピックに送信。
   * ない場合は新規トピック作成。
   */
  async function saveToTopic() {
    if (!aibaToken || !aibaApiUrl) {
      tools.toast('Ai-Ba アプリにログインしてページを開いてください')
      return
    }
    if (transcripts.length === 0) {
      tools.toast('文字起こしがありません')
      return
    }

    const btn = document.querySelector('#anSaveTopicBtn')
    if (btn) {
      btn.disabled = true
      btn.textContent = '保存中...'
    }

    try {
      await flushPendingEntries()

      const transcriptText = transcripts
        .map((t) => {
          const time = fmtTime(t.timestamp)
          return `[${time}] [${t.speaker}] ${t.text}`
        })
        .join('\n')

      const themeName = currentSessionTitle || `Meeting ${new Date().toLocaleString('ja-JP')}`
      let themeId = linkedThemeId

      // トピック未作成の場合は新規作成
      if (!themeId) {
        const createRes = await apiFetch(`${aibaApiUrl}/themes`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${aibaToken}`,
          },
          body: JSON.stringify({ themeName, isPrivate: true }),
        })

        if (!createRes.ok) {
          throw new Error(`テーマ作成失敗 (${createRes.status})`)
        }

        const data = JSON.parse(createRes.body)
        themeId = data.themeId
        linkedThemeId = themeId
      }

      // 文字起こしを送信 + AI要約リクエスト
      const chatRes = await apiFetch(`${aibaApiUrl}/llm/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aibaToken}`,
        },
        body: JSON.stringify({
          message: `以下は会議「${themeName}」の文字起こしです。内容を確認して、要約・要点・決定事項・TODOをまとめてください。\n\n${transcriptText}`,
          sessionId: themeId,
          themeId,
        }),
      })

      if (!chatRes.ok) {
        LOG('チャット送信エラー:', chatRes.status)
        tools.toast('トピック作成完了（AI要約は後で実行してください）')
      } else {
        tools.toast(`トピック「${themeName}」に保存しました`)
      }

      if (btn) {
        btn.textContent = '保存完了'
        btn.disabled = true
        setTimeout(() => updateSaveTopicBtn(), 3000)
      }
    } catch (err) {
      LOG('トピック保存エラー:', err)
      tools.toast(`保存エラー: ${err.message}`)
      if (btn) {
        btn.textContent = 'トピック保存'
        btn.disabled = false
      }
    }
  }

  // ──────────────────────────────────────────
  // リアルタイムストリーミング（Phase 2b）
  // ──────────────────────────────────────────

  /** 30秒ごとにバッチ送信するタイマーを開始 */
  function startStreamBatch() {
    if (streamBatchTimer) return
    LOG('ストリーミングバッチ開始（30秒間隔）')
    streamBatchTimer = setInterval(() => {
      flushStreamBatch()
    }, STREAM_INTERVAL)
  }

  /** バッチタイマーを停止 */
  function stopStreamBatch() {
    if (streamBatchTimer) {
      clearInterval(streamBatchTimer)
      streamBatchTimer = null
      LOG('ストリーミングバッチ停止')
    }
  }

  /** バッファに溜まった字幕エントリを POST /meeting/transcript に送信 */
  async function flushStreamBatch() {
    if (streamBatchEntries.length === 0 || !linkedThemeId || !aibaToken || !aibaApiUrl) return

    const entries = [...streamBatchEntries]
    streamBatchEntries = []

    try {
      const res = await apiFetch(`${aibaApiUrl}/meeting/transcript`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aibaToken}`,
        },
        body: JSON.stringify({
          themeId: linkedThemeId,
          entries,
        }),
      })

      if (!res.ok) {
        LOG('ストリーム送信エラー:', res.status)
        // 失敗した分を戻す
        streamBatchEntries.unshift(...entries)
      } else {
        const data = await res.json()
        LOG(`ストリーム送信完了: ${data.saved} 件`)
      }
    } catch (err) {
      LOG('ストリーム送信エラー:', err.message)
      streamBatchEntries.unshift(...entries)
    }
  }

  // ──────────────────────────────────────────
  // ページ離脱時の自動停止
  // ──────────────────────────────────────────
  window.addEventListener('beforeunload', () => {
    if (!isTranscribing) return
    stopStreamBatch()

    // keepalive: true で認証付きリクエストを送信（ページ離脱後も完了する）
    if (linkedThemeId && aibaToken && aibaApiUrl) {
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${aibaToken}` }
      if (streamBatchEntries.length > 0) {
        fetch(`${aibaApiUrl}/meeting/transcript`, {
          method: 'POST', headers, keepalive: true,
          body: JSON.stringify({ themeId: linkedThemeId, entries: streamBatchEntries }),
        }).catch(() => {})
      }
      fetch(`${aibaApiUrl}/meeting/transcript`, {
        method: 'POST', headers, keepalive: true,
        body: JSON.stringify({ action: 'meeting_ended', themeId: linkedThemeId, totalEntries: transcripts.length }),
      }).catch(() => {})
    }
    LOG('ページ離脱 — 文字起こし自動停止')
  })

  // ──────────────────────────────────────────
  // 初期化
  // ──────────────────────────────────────────
  LOG('ノーターツール読み込み完了 (v14: collections チャネルから話者名取得)')
  createNoterPanel()
})()
