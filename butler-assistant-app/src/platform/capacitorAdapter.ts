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
 * Note: 実際のCapacitor APIは各プラグインパッケージから提供されます。
 * このファイルはCapacitorをインストール後に実装を完成させます。
 */
class CapacitorAdapterImpl implements PlatformAdapter {
  getPlatform(): Platform {
    return 'capacitor'
  }

  async saveSecureData(key: SecureStorageKey, value: string): Promise<void> {
    // TODO: @capacitor-community/secure-storage-plugin を使用
    // await SecureStoragePlugin.set({ key, value })
    console.warn('[CapacitorAdapter] saveSecureData: Capacitor APIが未設定です')
    localStorage.setItem(`capacitor-secure:${key}`, value)
  }

  async loadSecureData(key: SecureStorageKey): Promise<string | null> {
    // TODO: @capacitor-community/secure-storage-plugin を使用
    // const result = await SecureStoragePlugin.get({ key })
    // return result.value
    console.warn('[CapacitorAdapter] loadSecureData: Capacitor APIが未設定です')
    return localStorage.getItem(`capacitor-secure:${key}`)
  }

  async deleteSecureData(key: SecureStorageKey): Promise<void> {
    // TODO: @capacitor-community/secure-storage-plugin を使用
    // await SecureStoragePlugin.remove({ key })
    console.warn('[CapacitorAdapter] deleteSecureData: Capacitor APIが未設定です')
    localStorage.removeItem(`capacitor-secure:${key}`)
  }

  async selectFile(options?: FileSelectOptions): Promise<SelectedFile[] | null> {
    // TODO: @capacitor/filesystem を使用
    // const result = await FilePicker.pickFiles({
    //   types: options?.accept,
    //   multiple: options?.multiple,
    // })
    console.warn('[CapacitorAdapter] selectFile: Capacitor APIが未設定です')

    // フォールバック: Web APIを使用
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

  async saveFile(_filename: string, _data: ArrayBuffer | string): Promise<string | null> {
    // TODO: @capacitor/filesystem を使用
    // const result = await Filesystem.writeFile({
    //   path: filename,
    //   data: typeof data === 'string' ? data : arrayBufferToBase64(data),
    //   directory: Directory.Documents,
    // })
    // return result.uri
    console.warn('[CapacitorAdapter] saveFile: Capacitor APIが未設定です')
    return null
  }

  async getAppDataPath(): Promise<string> {
    // TODO: @capacitor/filesystem を使用
    // const result = await Filesystem.getUri({
    //   path: '',
    //   directory: Directory.Data,
    // })
    // return result.uri
    console.warn('[CapacitorAdapter] getAppDataPath: Capacitor APIが未設定です')
    return '/app-data'
  }

  async showNotification(title: string, body: string): Promise<void> {
    // TODO: @capacitor/local-notifications を使用
    // await LocalNotifications.schedule({
    //   notifications: [{
    //     title,
    //     body,
    //     id: Date.now(),
    //   }],
    // })
    console.warn('[CapacitorAdapter] showNotification: Capacitor APIが未設定です')
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  }

  async copyToClipboard(text: string): Promise<void> {
    // TODO: @capacitor/clipboard を使用
    // await Clipboard.write({ string: text })
    console.warn('[CapacitorAdapter] copyToClipboard: Capacitor APIが未設定です')
    await navigator.clipboard.writeText(text)
  }

  async openExternalUrl(url: string): Promise<void> {
    // TODO: @capacitor/browser を使用
    // await Browser.open({ url })
    console.warn('[CapacitorAdapter] openExternalUrl: Capacitor APIが未設定です')
    window.open(url, '_blank')
  }
}

/**
 * Capacitor Adapter のシングルトンインスタンス
 */
export const capacitorAdapter = new CapacitorAdapterImpl()
