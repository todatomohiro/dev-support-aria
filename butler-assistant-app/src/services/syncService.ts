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
 */
class SyncServiceImpl {
  private accessToken: string | null = null
  private configUnsubscribe: (() => void) | null = null

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
        const merged = this.mergeMessages(store.messages, messagesResult.value)
        // ストアのメッセージを置き換え
        useAppStore.setState({ messages: merged })
      }
    } catch (error) {
      console.error('[Sync] ログイン同期エラー:', error)
    }

    // 設定変更の監視を開始
    this.startConfigSubscription()
  }

  /**
   * ログアウト時の処理
   */
  onLogout(): void {
    this.accessToken = null
    this.stopConfigSubscription()
  }

  /**
   * メッセージをサーバーに保存（fire-and-forget）
   */
  saveMessage(message: Message): void {
    if (!this.accessToken || !getApiBaseUrl()) return

    this.postMessages([message]).catch((error) => {
      console.error('[Sync] メッセージ保存エラー:', error)
    })
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

    // API キーはサーバーから取得しない（ローカルのみ）
    const settings = data.settings as Partial<AppConfig>
    if (settings.llm) {
      settings.llm = { ...settings.llm, apiKey: '' }
    }

    return settings
  }

  /**
   * サーバーからメッセージを取得
   */
  private async fetchMessages(): Promise<Message[]> {
    const res = await this.fetch('/messages?limit=100')
    const data = await res.json()
    return data.messages ?? []
  }

  /**
   * サーバーに設定を保存
   */
  private async saveSettingsToServer(config: AppConfig): Promise<void> {
    // API キーを除外して送信
    const sanitized = {
      ...config,
      llm: { ...config.llm, apiKey: '' },
    }

    await this.fetch('/settings', {
      method: 'PUT',
      body: JSON.stringify(sanitized),
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
