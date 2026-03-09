import { useGroupChatStore } from '@/stores/groupChatStore'
import { useThemeStore } from '@/stores/themeStore'
import { getIdToken } from '@/auth'
import { groupService } from '@/services/groupService'
import type { GroupMessage } from '@/types'

/** 最大再接続試行回数 */
const MAX_RECONNECT_ATTEMPTS = 5

/** 再接続バックオフ上限（ミリ秒） */
const MAX_BACKOFF_MS = 30000

/** チャットストリーミングイベント */
export type ChatStreamEvent =
  | { type: 'chat_delta'; requestId: string; delta: string }
  | { type: 'chat_tool_start'; requestId: string; tool: string }
  | { type: 'chat_tool_result'; requestId: string; tool: string }
  | { type: 'chat_complete'; requestId: string; content: string; [key: string]: unknown }
  | { type: 'chat_error'; requestId: string; error: string }

/** チャットストリーミングコールバック */
export type ChatStreamCallback = (event: ChatStreamEvent) => void

/**
 * WebSocket サービスのインターフェース
 */
/** ターミナルイベント */
export type TerminalEvent =
  | { type: 'terminal_output'; data: string }
  | { type: 'terminal_input'; data: string }

/** ターミナルイベントコールバック */
export type TerminalEventCallback = (event: TerminalEvent) => void

export interface WsServiceType {
  connect(token: string): void
  disconnect(): void
  reconnect(): void | Promise<void>
  subscribe(groupId: string): void
  unsubscribe(groupId: string): void
  isConnected(): boolean
  onChatStream(callback: ChatStreamCallback | null): void
  /** WebSocket でメッセージを送信 */
  send(message: Record<string, unknown>): void
  /** ターミナルイベントコールバックを登録 */
  onTerminalEvent(callback: TerminalEventCallback | null): void
}

/**
 * WebSocket サービス実装
 *
 * サーバーからのリアルタイムメッセージ配信を受信する。
 * 送信は既存 REST API を維持。
 */
export class WsServiceImpl implements WsServiceType {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private subscribedGroups = new Set<string>()
  private currentToken: string | null = null
  private chatStreamCallback: ChatStreamCallback | null = null
  private terminalEventCallback: TerminalEventCallback | null = null

  /**
   * WebSocket 接続を開始
   *
   * 同じトークンで既に接続中（OPEN or CONNECTING）なら再接続しない。
   */
  connect(token: string): void {
    // 既に同じトークンで接続中なら何もしない
    if (this.ws && this.currentToken === token && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    this.currentToken = token
    const wsUrl = import.meta.env.VITE_WS_URL
    if (!wsUrl) return

    this.cleanup()

    const store = useGroupChatStore.getState()
    store.setWsStatus('connecting')

    this.ws = new WebSocket(`${wsUrl}?token=${token}`)

    this.ws.onopen = () => {
      const wasReconnect = this.reconnectAttempts > 0
      this.reconnectAttempts = 0
      useGroupChatStore.getState().setWsStatus('open')

      // 再接続時に取りこぼしを補完
      if (wasReconnect) {
        const { activeGroupId, lastPollTimestamp } = useGroupChatStore.getState()
        if (activeGroupId && lastPollTimestamp) {
          groupService.pollNewMessages(activeGroupId, lastPollTimestamp)
            .then((msgs) => {
              if (msgs.length > 0) {
                const s = useGroupChatStore.getState()
                s.appendMessages(msgs)
                const maxTs = Math.max(...msgs.map((m) => m.timestamp))
                s.setLastPollTimestamp(maxTs)
              }
            })
            .catch(() => { /* 補完失敗は無視 */ })
        }
      }
    }

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        this.handleMessage(data)
      } catch {
        console.error('[wsService] メッセージのパースに失敗')
      }
    }

    this.ws.onclose = () => {
      this.ws = null
      this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      // onclose will fire after onerror
    }
  }

  /**
   * WebSocket 接続を切断
   */
  disconnect(): void {
    this.currentToken = null
    this.cleanup()
    useGroupChatStore.getState().setWsStatus('disconnected')
  }

  /**
   * 手動で再接続を試行（再接続カウンタをリセット）
   */
  async reconnect(): Promise<void> {
    this.reconnectAttempts = 0
    this.cleanup()
    const token = this.currentToken ?? await getIdToken()
    if (token) {
      this.connect(token)
    }
  }

  /**
   * グループを購読（メッセージ受信対象に追加）
   */
  subscribe(groupId: string): void {
    this.subscribedGroups.add(groupId)
  }

  /**
   * グループの購読を解除
   */
  unsubscribe(groupId: string): void {
    this.subscribedGroups.delete(groupId)
  }

  /**
   * WebSocket 接続中かどうかを返す
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  /**
   * チャットストリーミングコールバックを登録
   */
  onChatStream(callback: ChatStreamCallback | null): void {
    this.chatStreamCallback = callback
  }

  /**
   * WebSocket でメッセージを送信
   */
  send(message: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  /**
   * ターミナルイベントコールバックを登録
   */
  onTerminalEvent(callback: TerminalEventCallback | null): void {
    this.terminalEventCallback = callback
  }

  /**
   * 受信メッセージを処理
   */
  private handleMessage(data: { type: string; conversationId?: string; groupId?: string; message?: unknown; lastMessage?: string; updatedAt?: number; userId?: string; nickname?: string; lastReadAt?: number; requestId?: string; delta?: string; tool?: string; content?: string; error?: string; themeId?: string; entries?: unknown[]; startTime?: number; endTime?: number }): void {
    // チャットストリーミングイベント
    if (data.type.startsWith('chat_') && this.chatStreamCallback) {
      this.chatStreamCallback(data as ChatStreamEvent)
      return
    }

    // ターミナルイベント
    if (data.type.startsWith('terminal_')) {
      if (this.terminalEventCallback) {
        this.terminalEventCallback(data as unknown as TerminalEvent)
      }
      return
    }

    // 会議開始通知（拡張機能でトピック作成時 → アプリでトピック自動オープン）
    if (data.type === 'meeting_started' && data.themeId) {
      window.dispatchEvent(new CustomEvent('aiba-meeting-started', {
        detail: { themeId: data.themeId, themeName: (data as { themeName?: string }).themeName },
      }))
      return
    }

    // 会議終了通知
    if (data.type === 'meeting_ended' && data.themeId) {
      window.dispatchEvent(new CustomEvent('aiba-meeting-ended', {
        detail: { themeId: data.themeId, totalEntries: (data as { totalEntries?: number }).totalEntries ?? 0 },
      }))
      return
    }

    // 会議トランスクリプトチャンク（拡張機能からのリアルタイム字幕）
    if (data.type === 'transcript_chunk' && data.themeId && Array.isArray(data.entries)) {
      const store = useThemeStore.getState()
      // アクティブなテーマと一致する場合のみメッセージに追加
      if (store.activeThemeId === data.themeId) {
        const entries = data.entries as Array<{ speaker: string; text: string; timestamp: number; source: string }>
        const speakers = [...new Set(entries.map(e => e.speaker))]
        store.addMessage({
          id: `tr-${data.startTime}-${data.endTime}`,
          role: 'transcript' as const,
          content: `${speakers.join('・')} — ${entries.length}件の発言`,
          timestamp: data.startTime ?? Date.now(),
          transcriptEntries: entries,
        })
      }
      return
    }

    const store = useGroupChatStore.getState()
    // conversationId と groupId の両方をサポート（後方互換）
    const targetId = data.groupId ?? data.conversationId

    if (data.type === 'new_message' && data.message && targetId) {
      const msg = data.message as GroupMessage
      if (this.subscribedGroups.has(targetId)) {
        store.appendMessages([msg])
        store.setLastPollTimestamp(msg.timestamp)
      } else {
        store.incrementUnread(targetId)
      }
    }

    if (data.type === 'conversation_updated' && targetId && data.lastMessage !== undefined && data.updatedAt !== undefined) {
      store.updateGroupSummary(targetId, data.lastMessage, data.updatedAt)
    }

    if (data.type === 'member_added' && targetId) {
      // メンバー追加通知 — メンバーリストをリロード
      if (this.subscribedGroups.has(targetId)) {
        groupService.getMembers(targetId)
          .then(({ members }) => store.setActiveMembers(members))
          .catch(() => { /* 失敗は無視 */ })
      }
    }

    if (data.type === 'member_left' && targetId) {
      // メンバー退出通知 — メンバーリストをリロード
      if (this.subscribedGroups.has(targetId)) {
        groupService.getMembers(targetId)
          .then(({ members }) => store.setActiveMembers(members))
          .catch(() => { /* 失敗は無視 */ })
      }
    }
  }

  /**
   * 再接続をスケジュール（指数バックオフ）
   */
  private scheduleReconnect(): void {
    this.reconnectAttempts++
    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      useGroupChatStore.getState().setWsStatus('failed')
      return
    }

    const backoff = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), MAX_BACKOFF_MS)
    useGroupChatStore.getState().setWsStatus('connecting')

    this.reconnectTimer = setTimeout(async () => {
      // 最新のトークンを取得して再接続
      const token = this.currentToken ?? await getIdToken()
      if (token) {
        this.connect(token)
      } else {
        useGroupChatStore.getState().setWsStatus('failed')
      }
    }, backoff)
  }

  /**
   * WebSocket とタイマーをクリーンアップ
   */
  private cleanup(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.close()
      this.ws = null
    }
  }
}

/** WsService のシングルトンインスタンス */
export const wsService: WsServiceType = new WsServiceImpl()
