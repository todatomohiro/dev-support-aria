import type {
  PlatformAdapter,
  Platform,
  SecureStorageKey,
  FileSelectOptions,
  SelectedFile,
} from './types'

/**
 * Capacitor Platform Adapter
 * iOS/Androidモバイルアプリ用のプラットフォーム実装
 *
 * Capacitor プラグインは動的 import で読み込み、
 * テスト環境・Web 環境でのインポートエラーを防止する。
 */
class CapacitorAdapterImpl implements PlatformAdapter {
  /** プラットフォーム種別を取得 */
  getPlatform(): Platform {
    return 'capacitor'
  }

  /**
   * セキュアデータを保存（Capacitor Preferences プラグイン使用）
   */
  async saveSecureData(key: SecureStorageKey, value: string): Promise<void> {
    const { Preferences } = await import('@capacitor/preferences')
    await Preferences.set({ key, value })
  }

  /**
   * セキュアデータを読み込み（Capacitor Preferences プラグイン使用）
   */
  async loadSecureData(key: SecureStorageKey): Promise<string | null> {
    const { Preferences } = await import('@capacitor/preferences')
    const result = await Preferences.get({ key })
    return result.value
  }

  /**
   * セキュアデータを削除（Capacitor Preferences プラグイン使用）
   */
  async deleteSecureData(key: SecureStorageKey): Promise<void> {
    const { Preferences } = await import('@capacitor/preferences')
    await Preferences.remove({ key })
  }

  /**
   * ファイル選択ダイアログを表示（Web API 使用）
   *
   * WKWebView 内で Web File API が動作するため維持。
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
   * WKWebView 内で Blob download が動作するため Web API を維持。
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
   * アプリデータディレクトリのパスを取得
   *
   * Capacitor はファイルパスをプラグインが抽象化するため固定パスを返す。
   */
  async getAppDataPath(): Promise<string> {
    return 'capacitor://app-data'
  }

  /**
   * 通知を表示（Web Notifications API 使用）
   *
   * WKWebView 内で Web Notifications API が動作するため維持。
   */
  async showNotification(title: string, body: string): Promise<void> {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  }

  /**
   * クリップボードにコピー（Capacitor Clipboard プラグイン使用）
   */
  async copyToClipboard(text: string): Promise<void> {
    const { Clipboard } = await import('@capacitor/clipboard')
    await Clipboard.write({ string: text })
  }

  /**
   * 外部URLをSFSafariViewControllerで開く（Capacitor Browser プラグイン使用）
   */
  async openExternalUrl(url: string): Promise<void> {
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url })
  }
}

/**
 * Capacitor Adapter のシングルトンインスタンス
 */
export const capacitorAdapter = new CapacitorAdapterImpl()
