/**
 * Ai-Ba Tools — Meeting Noter ツール（v9: セッション管理 + AI チャット）
 *
 * - 自分の音声: Web Speech API（マイク）で直接認識
 * - 参加者の音声: tabCapture → offscreen → Amazon Transcribe Streaming
 * - 録音開始時にミーティングセッションを自動作成（DynamoDB 保存）
 * - URL 変更で新しいセッション作成
 * - AI チャットは Bedrock Claude Haiku で回答
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
  let micRecognition = null
  let isMicListening = false
  let isTranscribing = false     // 文字起こし全体の ON/OFF
  let isMicMuted = false
  let isCaptionMuted = false
  let captionEnabled = true      // 参加者字幕を受信するか（isTranscribing と連動）
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
      <div class="an-tabs">
        <button class="an-tab active" data-tab="transcript">文字起こし</button>
        <button class="an-tab" data-tab="chat">AI チャット</button>
      </div>
      <div class="an-transcript" id="anTranscript">
        <div class="an-empty" id="anEmpty">
          <div class="an-empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></div>
          <p>「文字起こし開始」を押すと<br>録音が始まります</p>
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
          <div class="an-sub-controls" id="anSubControls" style="display:none;">
            <button class="an-sub-mute" id="anMicMute" title="自分のマイクをミュート">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
              <span>自分</span>
            </button>
            <button class="an-sub-mute" id="anCaptionMute" title="参加者の字幕をミュート">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <span>参加者</span>
            </button>
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
      <div class="an-chat" id="anChat">
        <div class="an-chat-messages" id="anChatMessages">
          <div class="an-chat-msg system">
            文字起こしを元に要約や質問ができます。<br>
            マイクまたはタブ音声を録音してください。
          </div>
        </div>
        <div class="an-quick">
          <button class="an-quick-btn" data-prompt="ここまでの会話を要約してください">要約</button>
          <button class="an-quick-btn" data-prompt="要点を箇条書きにしてください">要点整理</button>
          <button class="an-quick-btn" data-prompt="決定事項とTODOをまとめてください">決定/TODO</button>
          <button class="an-quick-btn" data-prompt="最後の質問に対する回答案を考えてください">回答案</button>
        </div>
        <div class="an-input-area">
          <input type="text" class="an-input" id="anInput" placeholder="質問や指示を入力..." />
          <button class="an-send-btn" id="anSendBtn">送信</button>
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

    // タブ切り替え
    panel.querySelectorAll('.an-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.an-tab').forEach((t) => t.classList.remove('active'))
        tab.classList.add('active')
        const isTranscript = tab.dataset.tab === 'transcript'
        panel.querySelector('#anTranscript').style.display = isTranscript ? '' : 'none'
        panel.querySelector('#anToolbar').style.display = isTranscript ? '' : 'none'
        const chat = panel.querySelector('#anChat')
        if (isTranscript) { chat.classList.remove('active') } else { chat.classList.add('active') }
      })
    })

    panel.querySelector('#anMainToggle').addEventListener('click', toggleTranscription)
    panel.querySelector('#anMicMute').addEventListener('click', toggleMicMute)
    panel.querySelector('#anCaptionMute').addEventListener('click', toggleCaptionMute)

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
          const src = t.source === 'mic' ? '[自分]' : `[${t.speaker}]`
          return `[${time}] ${src} ${t.text}`
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
      tp.innerHTML = '<div class="an-empty" id="anEmpty"><div class="an-empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></div><p>録音ボタンを押すと<br>文字起こしが始まります</p></div>'
      panel.querySelector('#anCount').textContent = '0 件'
      updateNoterBadge()
    })

    // クイックアクション
    panel.querySelectorAll('.an-quick-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.prompt) sendMessage(btn.dataset.prompt)
      })
    })

    // 送信
    panel.querySelector('#anSendBtn').addEventListener('click', () => {
      const text = panel.querySelector('#anInput').value.trim()
      if (text) sendMessage(text)
    })
    panel.querySelector('#anInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        const text = panel.querySelector('#anInput').value.trim()
        if (text) sendMessage(text)
      }
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
      isMicMuted = false
      isCaptionMuted = false
      stopMicRecording()
      stopStreamBatch()
      updateRecUI()
      LOG('文字起こし終了')

      // 残りのバッチをフラッシュしてから自動保存
      flushStreamBatch().then(() => autoSaveToTopic())
    } else {
      // 開始
      isTranscribing = true
      captionEnabled = true
      isMicMuted = false
      isCaptionMuted = false
      await ensureSession()
      startMicRecording()
      updateRecUI()
      LOG('文字起こし開始')

      // Ai-Ba にプライベートトピックを自動作成 → 成功したらストリーミング開始
      autoCreateTopic().then(() => {
        if (linkedThemeId) startStreamBatch()
      })
    }
  }

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
      const res = await fetch(`${aibaApiUrl}/themes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aibaToken}`,
        },
        body: JSON.stringify({ themeName, isPrivate: true }),
      })

      if (!res.ok) {
        LOG('トピック自動作成失敗:', res.status)
        return
      }

      const data = await res.json()
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
      await fetch(`${aibaApiUrl}/meeting/transcript`, {
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
          const src = t.source === 'mic' ? '[自分]' : `[${t.speaker}]`
          return `[${time}] ${src} ${t.text}`
        })
        .join('\n')

      const themeName = currentSessionTitle || 'Meeting'
      LOG('トピック自動保存:', themeId, `${transcripts.length}件`)

      const res = await fetch(`${aibaApiUrl}/llm/chat`, {
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
  // マイク音声認識 (Web Speech API — 自分の声)
  // ──────────────────────────────────────────

  async function startMicRecording() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      tools.toast('このブラウザは音声認識に対応していません')
      return
    }

    micRecognition = new SpeechRecognition()
    micRecognition.lang = 'ja-JP'
    micRecognition.continuous = true
    micRecognition.interimResults = true
    micRecognition.maxAlternatives = 1

    micRecognition.onstart = () => {
      LOG('マイク音声認識を開始')
      isMicListening = true
      updateRecUI()
    }

    micRecognition.onresult = (event) => {
      if (isMicMuted) return
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0].transcript.trim()
        if (!text) continue

        if (result.isFinal) {
          addTranscript('自分', text, Date.now(), 'mic')
          removeInterim('mic')
        } else {
          updateInterim(text, 'mic')
        }
      }
    }

    micRecognition.onerror = (event) => {
      LOG('マイク音声認識エラー:', event.error)
      if (event.error === 'not-allowed') {
        tools.toast('マイクへのアクセスが拒否されました')
      } else if (event.error !== 'no-speech') {
        tools.toast(`マイクエラー: ${event.error}`)
      }
    }

    micRecognition.onend = () => {
      if (isMicListening) {
        LOG('マイク音声認識 自動再開')
        try { micRecognition.start() } catch (e) {
          LOG('マイク再開失敗:', e)
          isMicListening = false
          updateRecUI()
        }
      }
    }

    try {
      micRecognition.start()
    } catch (e) {
      LOG('マイク開始失敗:', e)
      tools.toast('マイク音声認識の開始に失敗しました')
    }
  }

  function stopMicRecording() {
    isMicListening = false
    if (micRecognition) {
      // onend を除去してから stop — 古いインスタンスの onend が新セッションを妨害するのを防止
      micRecognition.onend = null
      micRecognition.stop()
      micRecognition = null
    }
    removeInterim('mic')
    updateRecUI()
    // 停止時に未送信分をフラッシュ
    flushPendingEntries()
    LOG('マイク音声認識を停止')
  }

  // ──────────────────────────────────────────
  // ミュートトグル（サブコントロール）
  // ──────────────────────────────────────────
  function toggleMicMute() {
    isMicMuted = !isMicMuted
    updateRecUI()
    LOG(`マイク ${isMicMuted ? 'ミュート' : 'ミュート解除'}`)
  }

  function toggleCaptionMute() {
    isCaptionMuted = !isCaptionMuted
    updateRecUI()
    LOG(`参加者字幕 ${isCaptionMuted ? 'ミュート' : 'ミュート解除'}`)
  }

  // ──────────────────────────────────────────
  // 参加者音声（Google Meet 字幕 DOM スクレイピング）
  // ──────────────────────────────────────────
  // meet-captions.js が字幕 DOM を監視し、CustomEvent で転送してくる。
  // tabCapture/desktopCapture は不要。

  document.addEventListener('aiba-caption', (e) => {
    if (!captionEnabled || isCaptionMuted) return
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
      if (!captionEnabled || isCaptionMuted) return
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
    const subControls = document.querySelector('#anSubControls')
    const micMuteBtn = document.querySelector('#anMicMute')
    const captionMuteBtn = document.querySelector('#anCaptionMute')
    const active = isMicListening || (captionEnabled && captionDataActive)

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
      } else {
        const parts = []
        if (isMicListening && !isMicMuted) parts.push('マイク録音中')
        else if (isMicMuted) parts.push('マイクミュート')
        if (captionDataActive && !isCaptionMuted) parts.push('参加者受信中')
        else if (isCaptionMuted) parts.push('参加者ミュート')
        else if (!captionDataActive) parts.push('参加者待機中')
        mainStatus.textContent = parts.join(' / ')
      }
    }

    // サブコントロール（文字起こし中のみ表示）
    if (subControls) {
      subControls.style.display = isTranscribing ? '' : 'none'
    }

    // マイクミュートボタン
    if (micMuteBtn) {
      if (isMicMuted) {
        micMuteBtn.classList.add('muted')
        micMuteBtn.title = '自分のミュート解除'
      } else {
        micMuteBtn.classList.remove('muted')
        micMuteBtn.title = '自分のマイクをミュート'
      }
    }

    // 参加者ミュートボタン
    if (captionMuteBtn) {
      if (isCaptionMuted) {
        captionMuteBtn.classList.add('muted')
        captionMuteBtn.title = '参加者のミュート解除'
      } else {
        captionMuteBtn.classList.remove('muted')
        captionMuteBtn.title = '参加者の字幕をミュート'
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

    const label = source === 'mic' ? '自分' : ''
    const color = source === 'mic' ? '#a78bfa' : '#60a5fa'
    interim.innerHTML = `<div class="an-entry-speaker" style="color:${color}">${label}</div>`
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

  function entryHTML(entry) {
    const color = entry.source === 'mic' ? '#a78bfa' : '#60a5fa'
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
  // AI チャット
  // ──────────────────────────────────────────
  async function sendMessage(userMessage) {
    const panel = document.getElementById('aiba-noter-panel')
    if (!panel) return
    const input = panel.querySelector('#anInput')
    const sendBtn = panel.querySelector('#anSendBtn')
    const messages = panel.querySelector('#anChatMessages')

    input.value = ''
    sendBtn.disabled = true
    appendChat(messages, 'user', userMessage)

    if (transcripts.length === 0) {
      appendChat(messages, 'system', 'まだ文字起こしがありません。録音を開始してください。')
      sendBtn.disabled = false
      return
    }

    // 未送信分をフラッシュしてからAIに問い合わせ
    await flushPendingEntries()

    try {
      const response = await callAI(userMessage)
      appendChat(messages, 'assistant', response)
    } catch (err) {
      appendChat(messages, 'system', `エラー: ${err.message}`)
    }
    sendBtn.disabled = false
  }

  function appendChat(container, role, text) {
    const el = document.createElement('div')
    el.className = `an-chat-msg ${role}`
    el.textContent = text
    container.appendChild(el)
    container.scrollTop = container.scrollHeight
  }

  async function callAI(userMessage) {
    if (!NOTER_API_URL || !currentMeetingId) {
      return mockAI(userMessage)
    }

    const res = await fetch(NOTER_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ask',
        meetingId: currentMeetingId,
        question: userMessage,
      }),
    })

    if (!res.ok) throw new Error(`API エラー (${res.status})`)
    const data = await res.json()
    return data.answer || 'AI からの応答がありません'
  }

  function mockAI(userMessage) {
    const lines = transcripts.map((t) => t.text)
    if (userMessage.includes('要約')) {
      return `[PoC モック応答]\n\n会議の要約（${lines.length}件の発言）:\n\n`
        + lines.slice(0, 5).map((c, i) => `${i + 1}. ${c}`).join('\n')
        + (lines.length > 5 ? `\n... 他 ${lines.length - 5} 件` : '')
        + '\n\n※ API URL 設定後は実際の AI 要約が生成されます。'
    }
    if (userMessage.includes('要点') || userMessage.includes('箇条書き')) {
      return `[PoC モック応答]\n\n要点:\n${lines.slice(0, 8).map((c) => `- ${c}`).join('\n')}\n\n※ モック応答です。`
    }
    if (userMessage.includes('TODO') || userMessage.includes('決定')) {
      return `[PoC モック応答]\n\n決定事項・TODO:\n- (API 連携時に自動抽出)\n\n発言数: ${lines.length}件`
    }
    return `[PoC モック応答]\n\n文字起こし ${lines.length} 件\n質問: 「${userMessage}」\n\n※ NOTER_API_URL を設定すると AI 回答が表示されます。`
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
          const src = t.source === 'mic' ? '[自分]' : `[${t.speaker}]`
          return `[${time}] ${src} ${t.text}`
        })
        .join('\n')

      const themeName = currentSessionTitle || `Meeting ${new Date().toLocaleString('ja-JP')}`
      let themeId = linkedThemeId

      // トピック未作成の場合は新規作成
      if (!themeId) {
        const createRes = await fetch(`${aibaApiUrl}/themes`, {
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

        const data = await createRes.json()
        themeId = data.themeId
        linkedThemeId = themeId
      }

      // 文字起こしを送信 + AI要約リクエスト
      const chatRes = await fetch(`${aibaApiUrl}/llm/chat`, {
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
      const res = await fetch(`${aibaApiUrl}/meeting/transcript`, {
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
  // 初期化
  // ──────────────────────────────────────────
  LOG('ノーターツール読み込み完了 (v10: セッション管理 + AI + トピック保存)')
  createNoterPanel()
})()
