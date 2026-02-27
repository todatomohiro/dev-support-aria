import type {
  PlatformAdapter,
  Platform,
  SecureStorageKey,
  FileSelectOptions,
  SelectedFile,
} from './types'

/** Store ファイル名 */
const STORE_FILENAME = 'secure-store.json'

/**
 * Tauri Platform Adapter
 * Tauriデスクトップアプリ用のプラットフォーム実装
 *
 * Tauri プラグインは動的 import で読み込み、
 * テスト環境・Web 環境でのインポートエラーを防止する。
 */
class TauriAdapterImpl implements PlatformAdapter {
  /** プラットフォーム種別を取得 */
  getPlatform(): Platform {
    return 'tauri'
  }

  /**
   * セキュアデータを保存（Tauri Store プラグイン使用）
   */
  async saveSecureData(key: SecureStorageKey, value: string): Promise<void> {
    const { load } = await import('@tauri-apps/plugin-store')
    const store = await load(STORE_FILENAME)
    await store.set(key, value)
    await store.save()
  }

  /**
   * セキュアデータを読み込み（Tauri Store プラグイン使用）
   */
  async loadSecureData(key: SecureStorageKey): Promise<string | null> {
    const { load } = await import('@tauri-apps/plugin-store')
    const store = await load(STORE_FILENAME)
    const value = await store.get<string>(key)
    return value ?? null
  }

  /**
   * セキュアデータを削除（Tauri Store プラグイン使用）
   */
  async deleteSecureData(key: SecureStorageKey): Promise<void> {
    const { load } = await import('@tauri-apps/plugin-store')
    const store = await load(STORE_FILENAME)
    await store.delete(key)
    await store.save()
  }

  /**
   * ファイル選択ダイアログを表示（Web API 使用）
   *
   * Tauri の Dialog API はファイルパスのみ返却するため、
   * webview 内で動作する Web File API を使用する。
   */
  async selectFile(options?: FileSelectOptions): Promise<SelectedFile[] | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = options?.multiple ?? false
      if (options?.accept) {
        input.accept = options.accept.join(',')
      }

      input.onchange = async () => {
        const files = input.files
        if (!files || files.length === 0) {
          resolve(null)
          return
        }

        const selectedFiles: SelectedFile[] = []
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          const data = await file.arrayBuffer()
          selectedFiles.push({
            name: file.name,
            path: file.name,
            size: file.size,
            type: file.type,
            data,
          })
        }
        resolve(selectedFiles)
      }

      input.click()
    })
  }

  /**
   * ファイルを保存（Web API 使用）
   *
   * Tauri webview 内で Blob download が動作するため Web API を維持。
   */
  async saveFile(filename: string, data: ArrayBuffer | string): Promise<string | null> {
    const blob = data instanceof ArrayBuffer
      ? new Blob([data])
      : new Blob([data], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    return filename
  }

  /**
   * アプリデータディレクトリのパスを取得（Tauri Path API 使用）
   */
  async getAppDataPath(): Promise<string> {
    const { appDataDir } = await import('@tauri-apps/api/path')
    return await appDataDir()
  }

  /**
   * 通知を表示（Web Notifications API 使用）
   *
   * Tauri webview 内で Web Notifications API が動作するため維持。
   */
  async showNotification(title: string, body: string): Promise<void> {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  }

  /**
   * クリップボードにコピー（Web API 使用）
   *
   * Tauri webview 内で navigator.clipboard が動作するため維持。
   */
  async copyToClipboard(text: string): Promise<void> {
    await navigator.clipboard.writeText(text)
  }

  /**
   * 外部URLをOSデフォルトブラウザで開く（Tauri Opener プラグイン使用）
   */
  async openExternalUrl(url: string): Promise<void> {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
  }
}

/**
 * Tauri Adapter のシングルトンインスタンス
 */
export const tauriAdapter = new TauriAdapterImpl()
