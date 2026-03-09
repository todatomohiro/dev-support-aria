/**
 * Ai-Ba Tools — Popup Script (v3: 自動セットアップ)
 *
 * ポップアップを開いた瞬間に以下を自動実行:
 * 1. タブ音声キャプチャ開始（会議ページの場合）
 * 2. Ai-Ba 認証トークン取得
 *
 * Chrome 仕様上 tabCapture.getMediaStreamId() は popup コンテキストが必須。
 * 初回は拡張アイコンクリックが必要だが、開始後は content script から制御可能。
 */
'use strict'

const COGNITO_CLIENT_ID = '18tslkme57vdgl2lbe0kdg3j77'
const AIBA_APP_URL = 'http://localhost:5173'
const AIBA_API_URL = 'https://wpripgjmae.execute-api.ap-northeast-1.amazonaws.com/prod'

const MEETING_PATTERNS = [
  /^https:\/\/meet\.google\.com\//,
  /^https:\/\/.*\.zoom\.us\//,
  /^https:\/\/teams\.microsoft\.com\//,
]

// UI 要素
const dotCapture = document.getElementById('dotCapture')
const textCapture = document.getElementById('textCapture')
const dotAuth = document.getElementById('dotAuth')
const textAuth = document.getElementById('textAuth')
const progress = document.getElementById('progress')
const btnRetry = document.getElementById('btnRetry')
const btnStop = document.getElementById('btnStop')

let isCapturing = false

// ── ステータス更新ヘルパー ──
function setStatus(dot, text, status, message) {
  dot.className = `status-dot ${status}`
  text.textContent = message
}

function showProgress(message, isError = false) {
  progress.textContent = message
  progress.className = isError ? 'progress error' : 'progress'
  progress.style.display = 'block'
}

function hideProgress() {
  progress.style.display = 'none'
}

// ── メイン: 自動セットアップ ──
async function autoSetup() {
  hideProgress()
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab) return

  const isMeetingPage = MEETING_PATTERNS.some((p) => p.test(tab.url || ''))

  // タブキャプチャ + 認証トークン取得を並列実行
  await Promise.all([
    isMeetingPage ? setupCapture(tab) : skipCapture(),
    setupAuth(tab),
  ])
}

// ── タブ音声キャプチャ ──
async function skipCapture() {
  setStatus(dotCapture, textCapture, '', '会議ページではありません')
}

async function setupCapture(tab) {
  // 既にキャプチャ中か確認
  const res = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'get-capture-status' }, (r) => {
      void chrome.runtime.lastError
      resolve(r)
    })
  })

  if (res?.isCapturing) {
    isCapturing = true
    setStatus(dotCapture, textCapture, 'ok', 'キャプチャ中')
    btnStop.disabled = false
    return
  }

  setStatus(dotCapture, textCapture, 'loading', '開始中...')

  try {
    // popup コンテキストから tabCapture（Chrome 仕様上ここでのみ取得可能）
    let streamId
    try {
      streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id })
    } catch (e) {
      if (e.message?.includes('active stream')) {
        isCapturing = true
        setStatus(dotCapture, textCapture, 'ok', 'キャプチャ中')
        btnStop.disabled = false
        return
      }
      throw e
    }

    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'start-tab-capture-with-stream',
        streamId,
        tabId: tab.id,
      }, (r) => resolve(r))
    })

    if (response?.error) {
      setStatus(dotCapture, textCapture, 'error', response.error)
      return
    }

    isCapturing = true
    setStatus(dotCapture, textCapture, 'ok', 'キャプチャ中')
    btnStop.disabled = false
    notifyContentScript('active')
  } catch (err) {
    setStatus(dotCapture, textCapture, 'error', err.message)
  }
}

// ── Ai-Ba 認証トークン取得 ──
async function setupAuth(meetingTab) {
  // 既に保存済みか確認
  const stored = await chrome.storage.local.get(['aibaToken', 'aibaUserId'])
  if (stored.aibaToken) {
    // トークンの有効期限チェック（JWT exp）
    try {
      const payload = JSON.parse(atob(stored.aibaToken.split('.')[1]))
      if (payload.exp * 1000 > Date.now()) {
        setStatus(dotAuth, textAuth, 'ok', `連携済み`)
        notifyContentAuth(meetingTab, stored.aibaToken, stored.aibaUserId)
        return
      }
    } catch { /* 期限切れ or 不正 → 再取得 */ }
  }

  setStatus(dotAuth, textAuth, 'loading', 'トークン取得中...')

  try {
    // Ai-Ba アプリのタブを探す or 開く
    let aibaTabs = await chrome.tabs.query({ url: `${AIBA_APP_URL}/*` })
    let aibaTab
    let openedNew = false

    if (aibaTabs.length > 0) {
      aibaTab = aibaTabs[0]
    } else {
      aibaTab = await chrome.tabs.create({ url: AIBA_APP_URL, active: false })
      openedNew = true
      await new Promise((resolve) => {
        const listener = (tabId, changeInfo) => {
          if (tabId === aibaTab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener)
            resolve()
          }
        }
        chrome.tabs.onUpdated.addListener(listener)
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener)
          resolve()
        }, 10000)
      })
    }

    // localStorage からトークン読み取り
    const results = await chrome.scripting.executeScript({
      target: { tabId: aibaTab.id },
      func: (clientId) => {
        const lastAuthUser = localStorage.getItem(
          `CognitoIdentityServiceProvider.${clientId}.LastAuthUser`
        )
        if (!lastAuthUser) return null
        const idToken = localStorage.getItem(
          `CognitoIdentityServiceProvider.${clientId}.${lastAuthUser}.idToken`
        )
        return { idToken, username: lastAuthUser }
      },
      args: [COGNITO_CLIENT_ID],
    })

    // 自動で開いたタブは閉じる
    if (openedNew && aibaTab.id) {
      chrome.tabs.remove(aibaTab.id).catch(() => {})
    }

    const result = results?.[0]?.result
    if (!result?.idToken) {
      setStatus(dotAuth, textAuth, 'error', 'Ai-Ba にログインしてください')
      return
    }

    const payload = JSON.parse(atob(result.idToken.split('.')[1]))
    const userId = payload.sub

    await chrome.storage.local.set({
      aibaToken: result.idToken,
      aibaUserId: userId,
      aibaApiUrl: AIBA_API_URL,
    })

    setStatus(dotAuth, textAuth, 'ok', `連携済み`)
    notifyContentAuth(meetingTab, result.idToken, userId)
  } catch (err) {
    setStatus(dotAuth, textAuth, 'error', err.message)
  }
}

// ── content script への通知 ──
async function notifyContentScript(status) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'tab-capture-status', status }).catch(() => {})
  }
}

function notifyContentAuth(meetingTab, token, userId) {
  if (meetingTab?.id) {
    chrome.tabs.sendMessage(meetingTab.id, {
      type: 'aiba-auth-updated',
      token,
      userId,
      apiUrl: AIBA_API_URL,
    }).catch(() => {})
  }
}

// ── ボタン ──
btnRetry.addEventListener('click', () => {
  btnRetry.disabled = true
  autoSetup().finally(() => { btnRetry.disabled = false })
})

btnStop.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'stop-tab-capture' }, () => {
    void chrome.runtime.lastError
    isCapturing = false
    setStatus(dotCapture, textCapture, '', '停止済み')
    btnStop.disabled = true
    notifyContentScript('stopped')
  })
})

// ── 起動 ──
autoSetup()
