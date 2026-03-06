/**
 * Ai-Ba Virtual Camera — inject.js
 *
 * Meet / Zoom / YouTube のページに注入され、getUserMedia をフックして
 * Ai-Ba Studio Camera タブの映像をカメラ入力として差し替える。
 *
 * world: "MAIN" でページコンテキストに直接注入される。
 */
;(function () {
  'use strict'

  // 多重注入防止
  if (window.__aibaCameraInjected) return
  window.__aibaCameraInjected = true

  /** Ai-Ba ストリーム（getDisplayMedia で取得） */
  let aibaStream = null
  /** 有効フラグ */
  let aibaEnabled = false
  /** オリジナルの getUserMedia を退避 */
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  /** すべての RTCPeerConnection インスタンスを追跡 */
  const allPeerConnections = new Set()

  // ──────────────────────────────────────────
  // 1. RTCPeerConnection をフックしてインスタンスを追跡
  // ──────────────────────────────────────────
  const OriginalRTCPeerConnection = window.RTCPeerConnection

  window.RTCPeerConnection = function (...args) {
    const pc = new OriginalRTCPeerConnection(...args)
    allPeerConnections.add(pc)
    console.log('[Ai-Ba Camera] RTCPeerConnection 作成を検出, 総数:', allPeerConnections.size)

    // 接続終了時にクリーンアップ
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
        allPeerConnections.delete(pc)
      }
    })

    return pc
  }

  // プロトタイプチェーンを維持
  window.RTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype
  Object.setPrototypeOf(window.RTCPeerConnection, OriginalRTCPeerConnection)

  // ──────────────────────────────────────────
  // 2. getUserMedia をオーバーライド
  // ──────────────────────────────────────────
  navigator.mediaDevices.getUserMedia = async function (constraints) {
    if (!aibaEnabled || !aibaStream || !constraints?.video) {
      return originalGetUserMedia(constraints)
    }

    console.log('[Ai-Ba Camera] getUserMedia をインターセプト:', constraints)

    // Ai-Ba が有効: ビデオは Ai-Ba ストリーム、オーディオは実マイク
    const videoTracks = aibaStream.getVideoTracks()
    if (videoTracks.length === 0) {
      // ストリームが終了していた場合はフォールバック
      aibaEnabled = false
      aibaStream = null
      updateUI()
      return originalGetUserMedia(constraints)
    }

    if (constraints.audio) {
      try {
        const audioStream = await originalGetUserMedia({ audio: constraints.audio })
        const combined = new MediaStream([...videoTracks, ...audioStream.getAudioTracks()])
        console.log('[Ai-Ba Camera] Ai-Ba ビデオ + 実マイクを返却')
        return combined
      } catch {
        return new MediaStream(videoTracks)
      }
    }

    console.log('[Ai-Ba Camera] Ai-Ba ビデオストリームを返却')
    return new MediaStream(videoTracks)
  }

  // ──────────────────────────────────────────
  // 3. フローティング UI ボタン
  // ──────────────────────────────────────────
  function createUI() {
    const btn = document.createElement('button')
    btn.id = 'aiba-camera-toggle'
    btn.setAttribute('data-testid', 'aiba-camera-toggle')
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '80px',
      right: '20px',
      zIndex: '2147483647',
      padding: '10px 16px',
      border: 'none',
      borderRadius: '24px',
      fontSize: '13px',
      fontWeight: '600',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
      transition: 'all 0.2s ease',
      background: '#4f46e5',
      color: '#fff',
    })

    btn.addEventListener('click', handleToggle)
    btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.05)' })
    btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)' })

    const mount = () => {
      if (document.body) {
        document.body.appendChild(btn)
        updateUI()
      } else {
        requestAnimationFrame(mount)
      }
    }
    mount()

    return btn
  }

  /** UI 状態を更新（Trusted Types CSP 対応） */
  function updateUI() {
    const btn = document.getElementById('aiba-camera-toggle')
    if (!btn) return

    btn.textContent = ''
    const icon = document.createElement('span')
    icon.style.fontSize = '16px'
    icon.textContent = '\u{1F3AD}'
    btn.appendChild(icon)

    if (aibaEnabled) {
      btn.appendChild(document.createTextNode(' Ai-Ba ON'))
      btn.style.background = '#16a34a'
    } else {
      btn.appendChild(document.createTextNode(' Ai-Ba Camera'))
      btn.style.background = '#4f46e5'
    }
  }

  // ──────────────────────────────────────────
  // 4. トグル処理
  // ──────────────────────────────────────────
  async function handleToggle() {
    if (aibaEnabled) {
      // 無効化
      if (aibaStream) {
        aibaStream.getTracks().forEach((t) => t.stop())
      }
      aibaStream = null
      aibaEnabled = false
      updateUI()
      showToast('Ai-Ba Camera をオフにしました。ページを更新するとカメラが元に戻ります。')
    } else {
      // 有効化: getDisplayMedia でタブを選択
      try {
        // オリジナルの getDisplayMedia を直接使用
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            displaySurface: 'browser',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
          audio: false,
          preferCurrentTab: false,
        })

        aibaStream = stream
        aibaEnabled = true
        updateUI()

        console.log('[Ai-Ba Camera] ストリーム取得成功:', stream.getVideoTracks()[0]?.label)

        // ストリーム終了時の処理
        stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          console.log('[Ai-Ba Camera] ストリームが終了しました')
          aibaStream = null
          aibaEnabled = false
          updateUI()
        })

        // 既存の RTCPeerConnection の映像トラックを差し替え
        replaceActiveTracks(stream)

        showToast('Ai-Ba Camera が有効になりました')
      } catch (err) {
        console.log('[Ai-Ba Camera] キャンセルまたはエラー:', err)
      }
    }
  }

  /**
   * すべてのアクティブな PeerConnection の映像トラックを Ai-Ba ストリームに差し替え
   *
   * addTrack / addTransceiver どちらで追加されたトラックにも対応するため、
   * getSenders() ですべての sender を走査する。
   */
  function replaceActiveTracks(stream) {
    const newTrack = stream.getVideoTracks()[0]
    if (!newTrack) return

    let replacedCount = 0

    for (const pc of allPeerConnections) {
      try {
        const senders = pc.getSenders()
        for (const sender of senders) {
          if (sender.track && sender.track.kind === 'video') {
            sender.replaceTrack(newTrack)
            replacedCount++
            console.log('[Ai-Ba Camera] ビデオトラックを差し替え (PC state:', pc.connectionState, ')')
          }
        }
      } catch (err) {
        console.warn('[Ai-Ba Camera] トラック差し替えエラー:', err)
      }
    }

    console.log(`[Ai-Ba Camera] ${replacedCount} 件のビデオトラックを差し替えました (PeerConnection: ${allPeerConnections.size} 件)`)

    if (replacedCount === 0 && allPeerConnections.size === 0) {
      showToast('Ai-Ba Camera 準備完了。会議に参加するとカメラが切り替わります。')
    }
  }

  // ──────────────────────────────────────────
  // 5. トースト通知
  // ──────────────────────────────────────────
  function showToast(message) {
    const existing = document.getElementById('aiba-toast')
    if (existing) existing.remove()

    const toast = document.createElement('div')
    toast.id = 'aiba-toast'
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '140px',
      right: '20px',
      zIndex: '2147483647',
      padding: '10px 16px',
      borderRadius: '12px',
      fontSize: '12px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      background: 'rgba(0,0,0,0.8)',
      color: '#fff',
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
      transition: 'opacity 0.3s ease',
      opacity: '1',
    })
    toast.textContent = message
    document.body.appendChild(toast)

    setTimeout(() => {
      toast.style.opacity = '0'
      setTimeout(() => toast.remove(), 300)
    }, 3000)
  }

  // ──────────────────────────────────────────
  // 6. 初期化
  // ──────────────────────────────────────────
  createUI()
  console.log('[Ai-Ba Camera] 仮想カメラ拡張が読み込まれました')
})()
