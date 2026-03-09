/**
 * Ai-Ba Tools — App Bridge（認証トークン自動同期）
 *
 * Ai-Ba アプリのページで動作する content script。
 * Amplify が localStorage に保存した Cognito トークンを
 * chrome.storage.local に自動同期する。
 *
 * これにより、会議ページ側の content script（tool-noter.js 等）が
 * ポップアップ操作なしで認証済み API を呼び出せる。
 */
;(function () {
  'use strict'

  if (window.__aibaAppBridgeInstalled) return
  window.__aibaAppBridgeInstalled = true

  const COGNITO_CLIENT_ID = '18tslkme57vdgl2lbe0kdg3j77'
  const AIBA_API_URL =
    'https://wpripgjmae.execute-api.ap-northeast-1.amazonaws.com/prod'
  const LOG = (...args) => console.log('[Ai-Ba Bridge]', ...args)
  const SYNC_INTERVAL = 5 * 60 * 1000 // 5分ごとに同期

  /**
   * localStorage から Cognito の idToken を読み取る。
   * Amplify のキー規約:
   *   CognitoIdentityServiceProvider.{clientId}.LastAuthUser → username
   *   CognitoIdentityServiceProvider.{clientId}.{username}.idToken → JWT
   */
  function getTokenFromLocalStorage() {
    const lastAuthUser = localStorage.getItem(
      `CognitoIdentityServiceProvider.${COGNITO_CLIENT_ID}.LastAuthUser`
    )
    if (!lastAuthUser) return null

    const idToken = localStorage.getItem(
      `CognitoIdentityServiceProvider.${COGNITO_CLIENT_ID}.${lastAuthUser}.idToken`
    )
    if (!idToken) return null

    // JWT の有効期限を検証
    try {
      const payload = JSON.parse(atob(idToken.split('.')[1]))
      if (payload.exp * 1000 <= Date.now()) {
        LOG('トークン期限切れ')
        return null
      }
      return { idToken, userId: payload.sub }
    } catch {
      return null
    }
  }

  /**
   * トークンを chrome.storage.local に同期する。
   * 変更がなければスキップ。
   */
  async function syncToken() {
    const tokenData = getTokenFromLocalStorage()
    if (!tokenData) {
      LOG('トークン未検出（未ログイン or 期限切れ）')
      return false
    }

    // 既に同じトークンなら何もしない
    const stored = await chrome.storage.local.get(['aibaToken'])
    if (stored.aibaToken === tokenData.idToken) return true

    await chrome.storage.local.set({
      aibaToken: tokenData.idToken,
      aibaUserId: tokenData.userId,
      aibaApiUrl: AIBA_API_URL,
    })

    LOG('トークン同期完了:', tokenData.userId)

    // background script 経由で会議ページの content script に通知
    chrome.runtime.sendMessage({
      type: 'aiba-token-synced',
      token: tokenData.idToken,
      userId: tokenData.userId,
      apiUrl: AIBA_API_URL,
    }).catch(() => {})

    return true
  }

  // ──────────────────────────────────────────
  // 初期化
  // ──────────────────────────────────────────

  // 初回同期
  syncToken().then((ok) => {
    if (ok) {
      LOG('初回同期成功')
    }
  })

  // 定期同期（Amplify のトークンリフレッシュに追従）
  setInterval(syncToken, SYNC_INTERVAL)

  // localStorage の変更を監視
  // ※ storage イベントは「別タブ」からの変更のみ発火する。
  //   同一タブ内での Amplify リフレッシュは定期同期で拾う。
  window.addEventListener('storage', (e) => {
    if (e.key?.startsWith('CognitoIdentityServiceProvider.')) {
      LOG('localStorage 変更検出:', e.key)
      syncToken()
    }
  })

  LOG('初期化完了')
})()
