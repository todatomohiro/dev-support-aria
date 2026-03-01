import { useAppStore } from '@/stores/appStore'
import type { Message, AppConfig } from '@/types'
import { debounce } from '@/utils/performance'

/**
 * API ベース URL を取得（テスト時に import.meta.env を動的に参照するため関数化）
 */
function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL ?? ''
}

/**
 * データ同期サービス
 * ログイン時にサーバーからデータを取得し、変更時に都度保存する
 * 同一ブラウザのタブ間は BroadcastChannel、異なる端末間はポーリングで同期する
 */
class SyncServiceImpl {
  private accessToken: string | null = null
  private configUnsubscribe: (() => void) | null = null
  private channel: BroadcastChannel | null = null
  private pollingTimer: ReturnType<typeof setInterval> | null = null
  private visibilityHandler: (() => void) | null = null

  /** ポーリング間隔（ミリ秒） */
  static readonly POLLING_INTERVAL = 30_000

  /**
   * 設定保存（2秒デバウンス）
   */
  private debouncedSaveSettings = debounce((config: AppConfig) => {
    this.saveSettingsToServer(config)
  }, 2000)

  /**
   * ログイン時の処理
   * サーバーから設定・メッセージを取得してストアにマージ
   */
  async onLogin(token: string): Promise<void> {
    this.accessToken = token

    try {
      // 設定とメッセージを並列取得
      const [settingsResult, messagesResult] = await Promise.allSettled([
        this.fetchSettings(),
        this.fetchMessages(),
      ])

      const store = useAppStore.getState()

      // 設定のマージ
      if (settingsResult.status === 'fulfilled' && settingsResult.value) {
        store.updateConfig(settingsResult.value)
      }

      // メッセージのマージ
      if (messagesResult.status === 'fulfilled' && messagesResult.value) {
        const { messages, nextCursor } = messagesResult.value
        const merged = this.mergeMessages(store.messages, messages)
        // ストアのメッセージを置き換え + カーソル情報を保存
        useAppStore.setState({ messages: merged })
        store.setMessagesCursor(nextCursor)
        store.setHasEarlierMessages(!!nextCursor)
      }
    } catch (error) {
      console.error('[Sync] ログイン同期エラー:', error)
    }

    // 設定変更の監視を開始
    this.startConfigSubscription()

    // タブ間同期（BroadcastChannel）を開始
    this.startBroadcastChannel()

    // クロスデバイス同期（ポーリング）を開始
    this.startPolling()
  }

  /**
   * ログアウト時の処理
   */
  onLogout(): void {
    this.accessToken = null
    this.stopConfigSubscription()
    this.stopBroadcastChannel()
    this.stopPolling()
  }

  /**
   * メッセージをサーバーに保存（fire-and-forget）
   */
  saveMessage(message: Message): void {
    if (!this.accessToken || !getApiBaseUrl()) return

    this.postMessages([message]).catch((error) => {
      console.error('[Sync] メッセージ保存エラー:', error)
    })

    // 他タブへ即時通知
    this.channel?.postMessage(message)
  }

  /**
   * 設定をサーバーに保存（デバウンス付き）
   */
  saveSettings(config: AppConfig): void {
    if (!this.accessToken || !getApiBaseUrl()) return
    this.debouncedSaveSettings(config)
  }

  /**
   * メッセージを ID ベースで重複排除し、timestamp 順にソート
   */
  mergeMessages(local: Message[], server: Message[]): Message[] {
    const map = new Map<string, Message>()

    // サーバー側を先に追加
    for (const msg of server) {
      map.set(msg.id, msg)
    }

    // ローカル側で上書き（ローカルが最新）
    for (const msg of local) {
      map.set(msg.id, msg)
    }

    // timestamp 順にソート
    return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp)
  }

  /**
   * BroadcastChannel を開設し、他タブからのメッセージを受信する
   */
  private startBroadcastChannel(): void {
    this.stopBroadcastChannel()

    try {
      this.channel = new BroadcastChannel('butler-sync')
      this.channel.onmessage = (event: MessageEvent<Message>) => {
        const message = event.data
        const store = useAppStore.getState()

        // ID 重複チェック
        if (store.messages.some((m) => m.id === message.id)) return

        store.addMessage(message)
      }
    } catch {
      // BroadcastChannel 非対応環境では無視
    }
  }

  /**
   * BroadcastChannel を閉じる
   */
  private stopBroadcastChannel(): void {
    if (this.channel) {
      this.channel.close()
      this.channel = null
    }
  }

  /**
   * クロスデバイスポーリングを開始する
   * バックグラウンド時は停止し、フォアグラウンド復帰時に再開する
   */
  private startPolling(): void {
    this.stopPolling()

    this.pollingTimer = setInterval(() => {
      this.pollMessages()
    }, SyncServiceImpl.POLLING_INTERVAL)

    this.visibilityHandler = () => {
      if (document.hidden) {
        // バックグラウンド: ポーリング停止
        if (this.pollingTimer) {
          clearInterval(this.pollingTimer)
          this.pollingTimer = null
        }
      } else {
        // フォアグラウンド復帰: 即座にフェッチ＋ポーリング再開
        // iOS WKWebView ではバックグラウンド中に JS が凍結され、
        // hidden ハンドラーが呼ばれずタイマーが死ぬため、常に再作成する
        this.pollMessages()
        if (this.pollingTimer) {
          clearInterval(this.pollingTimer)
        }
        this.pollingTimer = setInterval(() => {
          this.pollMessages()
        }, SyncServiceImpl.POLLING_INTERVAL)
      }
    }

    document.addEventListener('visibilitychange', this.visibilityHandler)
  }

  /**
   * ポーリングを停止する
   */
  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer)
      this.pollingTimer = null
    }

    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler)
      this.visibilityHandler = null
    }
  }

  /**
   * サーバーからメッセージを取得し、差分があればストアを更新する
   */
  private async pollMessages(): Promise<void> {
    try {
      const { messages: serverMessages } = await this.fetchMessages()
      const store = useAppStore.getState()
      const merged = this.mergeMessages(store.messages, serverMessages)

      // 件数に差分がある場合のみ更新
      if (merged.length !== store.messages.length) {
        useAppStore.setState({ messages: merged })
      }
    } catch {
      // ポーリングエラーはクラッシュさせない
    }
  }

  /**
   * 設定変更の監視を開始
   */
  private startConfigSubscription(): void {
    this.stopConfigSubscription()

    this.configUnsubscribe = useAppStore.subscribe(
      (state, prevState) => {
        if (state.config !== prevState.config) {
          this.saveSettings(state.config)
        }
      }
    )
  }

  /**
   * 設定変更の監視を停止
   */
  private stopConfigSubscription(): void {
    if (this.configUnsubscribe) {
      this.configUnsubscribe()
      this.configUnsubscribe = null
    }
  }

  /**
   * サーバーから設定を取得
   */
  private async fetchSettings(): Promise<Partial<AppConfig> | null> {
    const res = await this.fetch('/settings')
    const data = await res.json()

    if (!data.settings) return null

    return data.settings as Partial<AppConfig>
  }

  /**
   * サーバーからメッセージを取得（カーソル情報も返す）
   */
  private async fetchMessages(): Promise<{ messages: Message[]; nextCursor: string | null }> {
    const res = await this.fetch('/messages?limit=100')
    const data = await res.json()
    return {
      messages: data.messages ?? [],
      nextCursor: data.nextCursor ?? null,
    }
  }

  /**
   * 過去のメッセージを取得（カーソルベースページネーション）
   */
  async fetchEarlierMessages(before: string, limit = 50): Promise<{ messages: Message[]; nextCursor: string | null }> {
    const res = await this.fetch(`/messages?limit=${limit}&before=${encodeURIComponent(before)}`)
    const data = await res.json()
    return {
      messages: data.messages ?? [],
      nextCursor: data.nextCursor ?? null,
    }
  }

  /**
   * サーバーに設定を保存
   */
  private async saveSettingsToServer(config: AppConfig): Promise<void> {
    await this.fetch('/settings', {
      method: 'PUT',
      body: JSON.stringify(config),
    })
  }

  /**
   * サーバーにメッセージを保存
   */
  private async postMessages(messages: Message[]): Promise<void> {
    await this.fetch('/messages', {
      method: 'POST',
      body: JSON.stringify(messages.length === 1 ? messages[0] : messages),
    })
  }

  /**
   * 認証付き fetch ヘルパー
   */
  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
        ...init?.headers,
      },
    })

    if (!res.ok) {
      throw new Error(`Sync API error: ${res.status} ${res.statusText}`)
    }

    return res
  }
}

/**
 * Sync Service のシングルトンインスタンス
 */
export const syncService = new SyncServiceImpl()

/**
 * テスト用にクラスをエクスポート
 */
export { SyncServiceImpl }
