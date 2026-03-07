import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { wsService } from '@/services/wsService'
import type { TerminalEvent } from '@/services/wsService'
import '@xterm/xterm/css/xterm.css'

/** Tauri 環境判定 */
const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** Tauri invoke を動的 import で取得 */
async function tauriInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke(cmd, args)
}

/** Tauri イベントリスナーを動的 import で登録 */
async function tauriListen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event')
  return listen<T>(event, handler)
}

interface PtyOutputPayload {
  session_id: string
  data: number[]
}

/** xterm.js テーマ（Tokyo Night） */
const TERMINAL_THEME = {
  background: '#1a1b26',
  foreground: '#a9b1d6',
  cursor: '#c0caf5',
  selectionBackground: '#33467c',
  black: '#32344a',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#ad8ee6',
  cyan: '#449dab',
  white: '#787c99',
  brightBlack: '#444b6a',
  brightRed: '#ff7a93',
  brightGreen: '#b9f27c',
  brightYellow: '#ff9e64',
  brightBlue: '#7da6ff',
  brightMagenta: '#bb9af7',
  brightCyan: '#0db9d7',
  brightWhite: '#acb0d0',
}

type Status = 'idle' | 'connecting' | 'connected' | 'error' | 'viewing' | 'exited'

/**
 * Terminal PoC
 *
 * Tauri 環境: PTY ホスト + WebSocket で出力を中継
 * Web/スマホ環境: WebSocket で出力を受信、入力を送信
 */
export function TerminalPoc() {
  const navigate = useNavigate()
  const termRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const cleanupRef = useRef<(() => void)[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [wsConnected, setWsConnected] = useState(false)

  // WS 接続状態を定期チェック
  useEffect(() => {
    const check = () => setWsConnected(wsService.isConnected())
    check()
    const timer = setInterval(check, 1000)
    return () => clearInterval(timer)
  }, [])

  /**
   * ホストモード: PTY 起動 + WS 出力中継（Tauri 環境）
   */
  const startHost = useCallback(async (term: Terminal) => {
    setStatus('connecting')
    try {
      const sessionId = `pty-${Date.now()}`
      const cols = term.cols
      const rows = term.rows

      // PTY 出力をバッチ化して WS 送信（100ms 間隔）
      let outputBuffer = ''
      let flushTimer: ReturnType<typeof setTimeout> | null = null
      const flushOutput = () => {
        if (outputBuffer && wsService.isConnected()) {
          wsService.send({ type: 'terminal_output', data: outputBuffer })
        }
        outputBuffer = ''
        flushTimer = null
      }

      const unlistenOutput = await tauriListen<PtyOutputPayload>('pty-output', (event) => {
        if (event.payload.session_id === sessionId) {
          const text = new TextDecoder().decode(new Uint8Array(event.payload.data))
          term.write(text)
          // バッファに蓄積して 100ms ごとにまとめて送信
          outputBuffer += text
          if (!flushTimer) {
            flushTimer = setTimeout(flushOutput, 100)
          }
        }
      })

      cleanupRef.current.push(() => {
        if (flushTimer) clearTimeout(flushTimer)
      })

      const unlistenExit = await tauriListen<PtyOutputPayload>('pty-exit', (event) => {
        if (event.payload.session_id === sessionId) {
          term.writeln('\r\n\x1b[1;31m[Process exited]\x1b[0m')
          setStatus('exited')
          wsService.send({ type: 'terminal_stop' })
        }
      })

      // リモートからの入力を PTY に書き込み
      const handleTerminalEvent = (event: TerminalEvent) => {
        if (event.type === 'terminal_input') {
          tauriInvoke('pty_write', { sessionId, data: event.data }).catch(() => {})
        }
      }
      wsService.onTerminalEvent(handleTerminalEvent)

      cleanupRef.current.push(
        unlistenOutput,
        unlistenExit,
        () => wsService.onTerminalEvent(null),
      )

      // PTY セッション起動
      await tauriInvoke('pty_spawn', { sessionId, rows, cols })
      sessionIdRef.current = sessionId
      setStatus('connected')

      // WS にターミナルセッション開始を通知
      wsService.send({ type: 'terminal_start', sessionId })

      // ローカルのキー入力を PTY に送信
      term.onData((data: string) => {
        tauriInvoke('pty_write', { sessionId, data }).catch(() => {})
      })
    } catch (e) {
      setStatus('error')
      setErrorMsg(String(e))
      term.writeln(`\r\n\x1b[1;31mError: ${String(e)}\x1b[0m`)
    }
  }, [])

  /**
   * ビューアーモード: WS 経由でターミナル表示・入力（Web/スマホ環境）
   */
  const startViewer = useCallback((term: Terminal) => {
    if (!wsService.isConnected()) {
      setStatus('error')
      setErrorMsg('WebSocket 未接続')
      term.writeln('\x1b[1;31mWebSocket 未接続\x1b[0m')
      term.writeln('ログインした状態でアクセスしてください。')
      return
    }

    setStatus('viewing')
    term.writeln('\x1b[1;32m=== Terminal Viewer (Remote) ===\x1b[0m')
    term.writeln('')
    term.writeln('PC 側でターミナルを起動すると、ここに出力が表示されます。')
    term.writeln('キー入力は PC のターミナルに送信されます。')
    term.writeln('')
    term.writeln('\x1b[33m待機中...\x1b[0m')

    const handleTerminalEvent = (event: TerminalEvent) => {
      if (event.type === 'terminal_output') {
        term.write(event.data)
      }
    }
    wsService.onTerminalEvent(handleTerminalEvent)

    term.onData((data: string) => {
      wsService.send({ type: 'terminal_input', data })
    })

    cleanupRef.current.push(() => wsService.onTerminalEvent(null))
  }, [])

  useEffect(() => {
    if (!termRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"SF Mono", "Menlo", "Monaco", "Courier New", monospace',
      theme: TERMINAL_THEME,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(termRef.current)
    fitAddon.fit()

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    if (isTauriEnv) {
      startHost(term)
    } else {
      startViewer(term)
    }

    const handleResize = () => fitAddon.fit()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      cleanupRef.current.forEach((fn) => fn())
      cleanupRef.current = []
      if (sessionIdRef.current && isTauriEnv) {
        tauriInvoke('pty_kill', { sessionId: sessionIdRef.current }).catch(() => {})
        wsService.send({ type: 'terminal_stop' })
      }
      term.dispose()
    }
  }, [startHost, startViewer])

  const statusConfig: Record<Status, { text: string; color: string; dot: string }> = {
    idle: { text: '待機中', color: 'text-gray-400', dot: 'bg-gray-500' },
    connecting: { text: '接続中...', color: 'text-yellow-400', dot: 'bg-yellow-400' },
    connected: { text: 'PTY ホスト (共有中)', color: 'text-green-400', dot: 'bg-green-400' },
    viewing: { text: 'リモートビューアー', color: 'text-blue-400', dot: 'bg-blue-400' },
    error: { text: `エラー: ${errorMsg}`, color: 'text-red-400', dot: 'bg-red-400' },
    exited: { text: 'プロセス終了', color: 'text-orange-400', dot: 'bg-orange-400' },
  }

  const current = statusConfig[status]

  return (
    <div className="flex-1 flex flex-col bg-gray-900 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/poc')}
            className="px-3 py-1 text-sm font-medium text-gray-300 bg-gray-700 border border-gray-600 rounded hover:bg-gray-600 transition-colors"
          >
            ← PoC
          </button>
          <h1 className="text-sm font-bold text-white">Terminal PoC</h1>
          <span className="text-xs text-gray-500">
            {isTauriEnv ? '[Host]' : '[Viewer]'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs ${wsConnected ? 'text-green-400' : 'text-red-400'}`}>
            WS:{wsConnected ? 'ON' : 'OFF'}
          </span>
          <span className={`text-xs ${current.color}`}>{current.text}</span>
          <span className={`w-2 h-2 rounded-full ${current.dot}`} />
        </div>
      </div>

      <div ref={termRef} className="flex-1 p-1" />
    </div>
  )
}
