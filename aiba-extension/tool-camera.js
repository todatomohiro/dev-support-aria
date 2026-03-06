/**
 * Ai-Ba Tools — 仮想カメラツール
 *
 * getUserMedia をフックして Ai-Ba Studio の映像をカメラとして差し替える。
 * ツールバーのカメラアイコンからパネルを開いて操作する。
 */
;(function () {
  'use strict'

  if (window.__aibaCameraInjected) return
  window.__aibaCameraInjected = true

  const LOG = (...args) => console.log('[Ai-Ba Camera]', ...args)
  const tools = window.__aibaTools

  // ──────────────────────────────────────────
  // カメラ状態
  // ──────────────────────────────────────────
  let aibaStream = null
  let aibaEnabled = false
  const originalGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  const trackedStreams = new Set()
  const allPCs = new Set()

  // ──────────────────────────────────────────
  // RTCPeerConnection 追跡
  // ──────────────────────────────────────────
  const OriginalRTCPC = window.RTCPeerConnection
  window.RTCPeerConnection = function (...args) {
    const pc = new OriginalRTCPC(...args)
    allPCs.add(pc)
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
        allPCs.delete(pc)
      }
    })
    return pc
  }
  window.RTCPeerConnection.prototype = OriginalRTCPC.prototype
  Object.setPrototypeOf(window.RTCPeerConnection, OriginalRTCPC)

  // ──────────────────────────────────────────
  // getUserMedia オーバーライド
  // ──────────────────────────────────────────
  navigator.mediaDevices.getUserMedia = async function (constraints) {
    if (aibaEnabled && aibaStream && constraints?.video) {
      LOG('Ai-Ba ストリームで応答')
      const videoTracks = aibaStream.getVideoTracks()
      if (videoTracks.length === 0) {
        aibaEnabled = false
        aibaStream = null
        updateCameraUI()
        return originalGUM(constraints)
      }
      if (constraints.audio) {
        try {
          const audioStream = await originalGUM({ audio: constraints.audio })
          return new MediaStream([...videoTracks, ...audioStream.getAudioTracks()])
        } catch {
          return new MediaStream(videoTracks)
        }
      }
      return new MediaStream(videoTracks)
    }

    const stream = await originalGUM(constraints)
    if (constraints?.video) trackedStreams.add(stream)
    return stream
  }

  // ──────────────────────────────────────────
  // ストリーム差し替え
  // ──────────────────────────────────────────
  function replaceAll(newStream) {
    const newTrack = newStream.getVideoTracks()[0]
    if (!newTrack) return

    // ローカルプレビュー
    for (const video of document.querySelectorAll('video')) {
      const src = video.srcObject
      if (!src || !(src instanceof MediaStream) || !trackedStreams.has(src)) continue
      video.srcObject = new MediaStream([newTrack, ...src.getAudioTracks()])
    }

    // PeerConnection sender
    for (const pc of allPCs) {
      try {
        for (const sender of pc.getSenders()) {
          if (sender.track?.kind === 'video') sender.replaceTrack(newTrack)
        }
      } catch (err) {
        LOG('sender replaceTrack エラー:', err)
      }
    }

    tools.toast('Ai-Ba Camera ON — カメラを一度 OFF → ON してください')
  }

  // ──────────────────────────────────────────
  // パネル作成
  // ──────────────────────────────────────────
  function createCameraPanel() {
    const panel = document.createElement('div')
    panel.id = 'aiba-camera-panel'
    panel.className = 'aiba-panel'
    panel.innerHTML = `
      <div class="ap-header">
        <div class="ap-header-left">
          <h3>Ai-Ba Camera</h3>
        </div>
        <button class="ap-close" id="aibaCameraClose">&times;</button>
      </div>
      <div class="ap-body">
        <div class="ap-status" id="aibaCameraStatus">
          カメラ未接続
        </div>
        <button class="ap-action-btn" id="aibaCameraToggle">
          Ai-Ba Camera を開始
        </button>
        <div class="ap-hint">
          1. Ai-Ba アプリでスタジオ &gt; 仮想カメラを開く<br>
          2. ここで「開始」をクリック<br>
          3. タブ選択で Ai-Ba Studio Camera を選択
        </div>
      </div>
    `

    const mount = () => {
      if (document.body) {
        document.body.appendChild(panel)
        initCameraEvents(panel)
        tools.makeDraggable(panel)
      } else {
        requestAnimationFrame(mount)
      }
    }
    mount()
  }

  function initCameraEvents(panel) {
    panel.querySelector('#aibaCameraClose').addEventListener('click', () => {
      tools.togglePanel('aiba-camera-panel', 'aiba-btn-camera')
    })

    panel.querySelector('#aibaCameraToggle').addEventListener('click', handleCameraToggle)
  }

  async function handleCameraToggle() {
    if (aibaEnabled) {
      aibaStream?.getTracks().forEach((t) => t.stop())
      aibaStream = null
      aibaEnabled = false
      updateCameraUI()
      tools.toast('Ai-Ba Camera OFF — ページ更新でカメラが戻ります')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: false,
        preferCurrentTab: false,
      })

      aibaStream = stream
      aibaEnabled = true
      updateCameraUI()

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        aibaStream = null
        aibaEnabled = false
        updateCameraUI()
      })

      replaceAll(stream)
    } catch (err) {
      LOG('キャンセルまたはエラー:', err)
    }
  }

  function updateCameraUI() {
    const btn = document.getElementById('aibaCameraToggle')
    const status = document.getElementById('aibaCameraStatus')
    const toolBtn = document.getElementById('aiba-btn-camera')

    if (btn) {
      if (aibaEnabled) {
        btn.textContent = 'Ai-Ba Camera を停止'
        btn.classList.add('active')
      } else {
        btn.textContent = 'Ai-Ba Camera を開始'
        btn.classList.remove('active')
      }
    }
    if (status) {
      status.textContent = aibaEnabled ? 'Ai-Ba Camera ON' : 'カメラ未接続'
      status.className = aibaEnabled ? 'ap-status active' : 'ap-status'
    }
    if (toolBtn) {
      if (aibaEnabled) {
        toolBtn.classList.add('on')
      } else {
        toolBtn.classList.remove('on')
      }
    }
  }

  // ──────────────────────────────────────────
  // 初期化
  // ──────────────────────────────────────────
  LOG('カメラツール読み込み完了')
  createCameraPanel()
})()
