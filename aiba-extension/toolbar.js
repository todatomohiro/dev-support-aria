/**
 * Ai-Ba Tools — メインツールバー
 *
 * Meet / Zoom / Teams の画面右側に縦型ツールバーを表示し、
 * 各ツール（カメラ、ノーター）のパネル開閉を管理する。
 */
;(function () {
  'use strict'

  if (window.__aibaToolsInjected) return
  window.__aibaToolsInjected = true

  const LOG = (...args) => console.log('[Ai-Ba Tools]', ...args)

  // ──────────────────────────────────────────
  // 共通ユーティリティ（各ツールから利用）
  // ──────────────────────────────────────────
  window.__aibaTools = {
    /** 現在開いているパネルID */
    activePanel: null,

    /** パネルの表示/非表示を切り替え */
    togglePanel(panelId, btnId) {
      const panel = document.getElementById(panelId)
      const btn = document.getElementById(btnId)
      if (!panel) return

      if (panel.classList.contains('visible')) {
        panel.classList.remove('visible')
        if (btn) btn.classList.remove('active')
        this.activePanel = null
      } else {
        // 他のパネルを閉じる
        document.querySelectorAll('.aiba-panel.visible').forEach((p) => {
          p.classList.remove('visible')
        })
        document.querySelectorAll('#aiba-toolbar .aiba-tool-btn.active').forEach((b) => {
          b.classList.remove('active')
        })

        panel.classList.add('visible')
        if (btn) btn.classList.add('active')
        this.activePanel = panelId

        // パネル位置をツールバー横に調整
        this.positionPanel(panel, btn)
      }
    },

    /** パネルをボタンの左横に配置 */
    positionPanel(panel, btn) {
      if (!btn) return
      const toolbar = document.getElementById('aiba-toolbar')
      if (!toolbar) return

      const toolbarRect = toolbar.getBoundingClientRect()
      const btnRect = btn.getBoundingClientRect()

      panel.style.right = `${window.innerWidth - toolbarRect.left + 8}px`
      panel.style.top = `${Math.max(10, btnRect.top - 40)}px`
      panel.style.bottom = 'auto'
      panel.style.left = 'auto'
    },

    /** パネルにドラッグ機能を追加 */
    makeDraggable(panel) {
      const header = panel.querySelector('.ap-header')
      if (!header) return

      let isDragging = false
      let offsetX = 0
      let offsetY = 0

      header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.ap-close')) return
        isDragging = true
        const rect = panel.getBoundingClientRect()
        offsetX = e.clientX - rect.left
        offsetY = e.clientY - rect.top
        e.preventDefault()
      })

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return
        panel.style.left = `${Math.max(0, e.clientX - offsetX)}px`
        panel.style.top = `${Math.max(0, e.clientY - offsetY)}px`
        panel.style.right = 'auto'
        panel.style.bottom = 'auto'
      })

      document.addEventListener('mouseup', () => { isDragging = false })
    },

    /** トースト通知 */
    toast(message) {
      const existing = document.getElementById('aiba-toast')
      if (existing) existing.remove()
      const el = document.createElement('div')
      el.id = 'aiba-toast'
      el.textContent = message
      document.body.appendChild(el)
      setTimeout(() => {
        el.style.opacity = '0'
        setTimeout(() => el.remove(), 300)
      }, 4000)
    },

    /** HTML エスケープ */
    escHtml(str) {
      const d = document.createElement('div')
      d.textContent = str
      return d.innerHTML
    },
  }

  // ──────────────────────────────────────────
  // ツールバー作成
  // ──────────────────────────────────────────
  function createToolbar() {
    const toolbar = document.createElement('div')
    toolbar.id = 'aiba-toolbar'
    toolbar.innerHTML = `
      <div class="aiba-drag-handle" id="aiba-drag-handle" title="ドラッグで移動">
        <span>&#x2630;</span>
      </div>
      <button class="aiba-tool-btn" id="aiba-btn-camera" data-tooltip="Ai-Ba Camera">
        &#x1F3AD;
      </button>
      <button class="aiba-tool-btn" id="aiba-btn-noter" data-tooltip="Meeting Noter">
        &#x1F399;
      </button>
    `

    const mount = () => {
      if (document.body) {
        document.body.appendChild(toolbar)
        setupToolbarEvents()
        setupToolbarDrag(toolbar)
      } else {
        requestAnimationFrame(mount)
      }
    }
    mount()
  }

  function setupToolbarEvents() {
    document.getElementById('aiba-btn-camera')?.addEventListener('click', () => {
      window.__aibaTools.togglePanel('aiba-camera-panel', 'aiba-btn-camera')
    })
    document.getElementById('aiba-btn-noter')?.addEventListener('click', () => {
      window.__aibaTools.togglePanel('aiba-noter-panel', 'aiba-btn-noter')
    })
  }

  function setupToolbarDrag(toolbar) {
    const handle = document.getElementById('aiba-drag-handle')
    if (!handle) return

    let isDragging = false
    let offsetX = 0
    let offsetY = 0

    handle.addEventListener('mousedown', (e) => {
      isDragging = true
      const rect = toolbar.getBoundingClientRect()
      offsetX = e.clientX - rect.left
      offsetY = e.clientY - rect.top
      toolbar.style.transition = 'none'
      e.preventDefault()
    })

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return
      const x = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - toolbar.offsetWidth))
      const y = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - toolbar.offsetHeight))
      toolbar.style.left = `${x}px`
      toolbar.style.top = `${y}px`
      toolbar.style.right = 'auto'
      toolbar.style.bottom = 'auto'
      toolbar.style.transform = 'none'
    })

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false
        toolbar.style.transition = ''
      }
    })
  }

  // ──────────────────────────────────────────
  // 初期化
  // ──────────────────────────────────────────
  LOG('ツールバー読み込み完了')
  createToolbar()
})()
