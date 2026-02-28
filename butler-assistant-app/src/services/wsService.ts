import { useMultiChatStore } from '@/stores/multiChatStore'
import { useAuthStore } from '@/auth/authStore'
import { conversationService } from '@/services/conversationService'
import type { ConversationMessage } from '@/types'

/** 最大再接続試行回数 */
const MAX_RECONNECT_ATTEMPTS = 5

/** 再接続バックオフ上限（ミリ秒） */
const MAX_BACKOFF_MS = 30000

/**
 * WebSocket サービスのインターフェース
 */
export interface WsServiceType {
  connect(token: string): void
  disconnect(): void
  reconnect(): void
  subscribe(conversationId: string): void
  unsubscribe(conversationId: string): void
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
  private subscribedConversations = new Set<string>()
  private currentToken: string | null = null

  /**
   * WebSocket 接続を開始
   */
  connect(token: string): void {
    this.currentToken = token
    const wsUrl = import.meta.env.VITE_WS_URL
    if (!wsUrl) return

    this.cleanup()

    const store = useMultiChatStore.getState()
    store.setWsStatus('connecting')

    this.ws = new WebSocket(`${wsUrl}?token=${token}`)

    this.ws.onopen = () => {
      const wasReconnect = this.reconnectAttempts > 0
      this.reconnectAttempts = 0
      useMultiChatStore.getState().setWsStatus('open')

      // 再接続時に取りこぼしを補完
      if (wasReconnect) {
        const { activeConversationId, lastPollTimestamp } = useMultiChatStore.getState()
        if (activeConversationId && lastPollTimestamp) {
          conversationService.pollNewMessages(activeConversationId, lastPollTimestamp)
            .then((msgs) => {
              if (msgs.length > 0) {
                const s = useMultiChatStore.getState()
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
    useMultiChatStore.getState().setWsStatus('disconnected')
  }

  /**
   * 手動で再接続を試行（再接続カウンタをリセット）
   */
  reconnect(): void {
    this.reconnectAttempts = 0
    const token = this.currentToken ?? useAuthStore.getState().accessToken
    if (token) {
      this.connect(token)
    }
  }

  /**
   * 会話を購読（メッセージ受信対象に追加）
   */
  subscribe(conversationId: string): void {
    this.subscribedConversations.add(conversationId)
  }

  /**
   * 会話の購読を解除
   */
  unsubscribe(conversationId: string): void {
    this.subscribedConversations.delete(conversationId)
  }

  /**
   * 受信メッセージを処理
   */
  private handleMessage(data: { type: string; conversationId: string; message?: unknown; lastMessage?: string; updatedAt?: number; lastReadAt?: number; userId?: string }): void {
    const store = useMultiChatStore.getState()

    if (data.type === 'new_message' && data.message) {
      const msg = data.message as ConversationMessage
      if (this.subscribedConversations.has(data.conversationId)) {
        store.appendMessages([msg])
        store.setLastPollTimestamp(msg.timestamp)
      } else {
        store.incrementUnread(data.conversationId)
      }
    }

    if (data.type === 'conversation_updated' && data.lastMessage !== undefined && data.updatedAt !== undefined) {
      store.updateConversationSummary(data.conversationId, data.lastMessage, data.updatedAt)
    }

    if (data.type === 'message_read' && data.lastReadAt !== undefined) {
      if (this.subscribedConversations.has(data.conversationId)) {
        store.setOtherLastReadAt(data.lastReadAt)
      }
    }
  }

  /**
   * 再接続をスケジュール（指数バックオフ）
   */
  private scheduleReconnect(): void {
    this.reconnectAttempts++
    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      useMultiChatStore.getState().setWsStatus('failed')
      return
    }

    const backoff = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), MAX_BACKOFF_MS)
    useMultiChatStore.getState().setWsStatus('connecting')

    this.reconnectTimer = setTimeout(() => {
      // 最新のトークンを取得して再接続
      const token = this.currentToken ?? useAuthStore.getState().accessToken
      if (token) {
        this.connect(token)
      } else {
        useMultiChatStore.getState().setWsStatus('failed')
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
