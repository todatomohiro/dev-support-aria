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
  let isTabCapturing = false
  const transcripts = []

  // セッション管理
  let currentMeetingId = null
  let currentSessionTitle = null
  let pendingEntries = [] // 未送信の文字起こし
  let flushTimer = null

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
          <p>録音ボタンを押すと<br>文字起こしが始まります</p>
        </div>
      </div>
      <div class="an-toolbar" id="anToolbar">
        <div style="display:flex;flex-direction:column;gap:4px;flex:1;">
          <button class="an-rec-btn" id="anRecBtn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>録音開始</button>
          <div class="an-source-toggles" id="anSourceToggles" style="display:none;">
            <label class="an-toggle-label"><input type="checkbox" id="anMicToggle" checked> マイク（自分）</label>
            <label class="an-toggle-label"><input type="checkbox" id="anTabToggle" checked> タブ音声（参加者）</label>
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

    panel.querySelector('#anRecBtn').addEventListener('click', toggleRecording)
    panel.querySelector('#anMicToggle').addEventListener('change', (e) => {
      if (isRecording()) {
        if (e.target.checked) startMicRecording()
        else stopMicRecording()
      }
    })
    panel.querySelector('#anTabToggle').addEventListener('change', (e) => {
      if (isRecording()) {
        if (e.target.checked) startTabCapture()
        else stopTabCapture()
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
          const src = t.source === 'tab-audio' ? '[参加者]' : '[自分]'
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
  // 統合録音制御
  // ──────────────────────────────────────────
  function isRecording() {
    return isMicListening || isTabCapturing
  }

  async function toggleRecording() {
    if (isRecording()) {
      // 両方停止
      if (isMicListening) stopMicRecording()
      if (isTabCapturing) stopTabCapture()
    } else {
      // セッション作成（1回だけ）
      await ensureSession()
      // チェックボックスの状態に従って開始
      const micToggle = document.querySelector('#anMicToggle')
      const tabToggle = document.querySelector('#anTabToggle')
      if (micToggle?.checked) startMicRecording()
      if (tabToggle?.checked) startTabCapture()
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
  // タブ音声キャプチャ（参加者の声）
  // ──────────────────────────────────────────
  async function startTabCapture() {
    LOG('タブ音声キャプチャを要求')

    chrome.runtime.sendMessage({ type: 'start-tab-capture' }, (response) => {
      void chrome.runtime.lastError
      if (response?.cancelled) {
        // ユーザーがダイアログでキャンセル
        LOG('タブ音声キャプチャ: ユーザーキャンセル')
        const tabToggle = document.querySelector('#anTabToggle')
        if (tabToggle) tabToggle.checked = false
        updateRecUI()
        return
      }
      if (response?.error) {
        LOG('タブキャプチャエラー:', response.error)
        tools.toast(`タブ音声エラー: ${response.error}`)
        return
      }
      isTabCapturing = true
      updateRecUI()
      LOG('タブ音声キャプチャ開始')
    })
  }

  function stopTabCapture() {
    chrome.runtime.sendMessage({ type: 'stop-tab-capture' }, () => {
      void chrome.runtime.lastError
      isTabCapturing = false
      removeInterim('tab')
      updateRecUI()
      flushPendingEntries()
      LOG('タブ音声キャプチャを停止')
    })
  }

  // background → content script へのメッセージ受信
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'tab-transcript') {
      if (message.isFinal) {
        addTranscript('参加者', message.text, message.timestamp, 'tab-audio')
        removeInterim('tab')
      } else {
        updateInterim(message.text, 'tab')
      }
    }

    if (message.type === 'tab-capture-status') {
      if (message.status === 'active') {
        isTabCapturing = true
        updateRecUI()
      } else if (message.status === 'error') {
        tools.toast(`タブ音声: ${message.error}`)
        isTabCapturing = false
        updateRecUI()
      } else if (message.status === 'stopped') {
        isTabCapturing = false
        updateRecUI()
      }
    }
  })

  // ──────────────────────────────────────────
  // UI 更新
  // ──────────────────────────────────────────
  function updateRecUI() {
    const recBtn = document.querySelector('#anRecBtn')
    const dot = document.querySelector('#anStatusDot')
    const toggles = document.querySelector('#anSourceToggles')
    const micToggle = document.querySelector('#anMicToggle')
    const tabToggle = document.querySelector('#anTabToggle')
    const recording = isRecording()

    if (recBtn) {
      const micSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>'
      const stopSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-2px;margin-right:4px;"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>'
      if (recording) {
        recBtn.innerHTML = stopSvg + '録音停止'
        recBtn.classList.add('recording')
      } else {
        recBtn.innerHTML = micSvg + '録音開始'
        recBtn.classList.remove('recording')
      }
    }

    // 録音中のみ個別トグルを表示
    if (toggles) {
      toggles.style.display = recording ? '' : 'none'
    }

    // 録音中のみチェックボックスを実際の状態と同期（停止時はユーザー設定を維持）
    if (recording) {
      if (micToggle) micToggle.checked = isMicListening
      if (tabToggle) tabToggle.checked = isTabCapturing
    }

    if (dot) {
      if (recording) {
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

    const label = source === 'tab' ? '参加者' : '自分'
    const color = source === 'tab' ? '#4f46e5' : '#7c3aed'
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
  }

  function entryHTML(entry) {
    const color = entry.source === 'tab-audio' ? '#4f46e5' : '#7c3aed'
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
    if (btn) {
      btn.style.display = aibaToken ? '' : 'none'
    }
  }

  async function saveToTopic() {
    if (!aibaToken || !aibaApiUrl) {
      tools.toast('先にポップアップから Ai-Ba 連携を行ってください')
      return
    }
    if (transcripts.length === 0) {
      tools.toast('文字起こしがありません')
      return
    }

    const btn = document.querySelector('#anSaveTopicBtn')
    btn.disabled = true
    btn.textContent = '保存中...'

    try {
      // 未送信分をフラッシュ
      await flushPendingEntries()

      // 文字起こしテキストを作成
      const transcriptText = transcripts
        .map((t) => {
          const time = fmtTime(t.timestamp)
          const src = t.source === 'tab-audio' ? '[参加者]' : '[自分]'
          return `[${time}] ${src} ${t.speaker}: ${t.text}`
        })
        .join('\n')

      const themeName = currentSessionTitle || `Meeting ${new Date().toLocaleString('ja-JP')}`

      // 1. テーマ作成
      LOG('トピック作成:', themeName, 'API:', aibaApiUrl)
      const createRes = await fetch(`${aibaApiUrl}/themes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aibaToken}`,
        },
        body: JSON.stringify({ themeName }),
      })

      if (!createRes.ok) {
        const errBody = await createRes.text()
        throw new Error(`テーマ作成失敗 (${createRes.status}): ${errBody}`)
      }

      const { themeId } = await createRes.json()

      // 2. 文字起こしを最初のメッセージとして送信
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
        // テーマは作成済みなのでエラーでもトピック自体は保存されている
        LOG('チャット送信エラー:', chatRes.status)
        tools.toast(`トピック作成完了（AI要約は後で実行してください）`)
      } else {
        tools.toast(`トピック「${themeName}」に保存しました`)
      }

      btn.textContent = '保存完了'
      setTimeout(() => {
        btn.textContent = 'トピック保存'
        btn.disabled = false
      }, 3000)
    } catch (err) {
      LOG('トピック保存エラー:', err)
      tools.toast(`保存エラー: ${err.message}`)
      btn.textContent = 'トピック保存'
      btn.disabled = false
    }
  }

  // ──────────────────────────────────────────
  // 初期化
  // ──────────────────────────────────────────
  LOG('ノーターツール読み込み完了 (v10: セッション管理 + AI + トピック保存)')
  createNoterPanel()
})()
