import type {
  PlatformAdapter,
  Platform,
  SecureStorageKey,
  FileSelectOptions,
  SelectedFile,
} from './types'

/**
 * Tauri Platform Adapter
 * Tauriデスクトップアプリ用のプラットフォーム実装
 *
 * Note: 実際のTauri APIは@tauri-apps/apiパッケージから提供されます。
 * このファイルはTauriをインストール後に実装を完成させます。
 */
class TauriAdapterImpl implements PlatformAdapter {
  getPlatform(): Platform {
    return 'tauri'
  }

  async saveSecureData(key: SecureStorageKey, value: string): Promise<void> {
    // TODO: Tauri Secure Storage APIを使用
    // await invoke('save_secure_data', { key, value })
    console.warn('[TauriAdapter] saveSecureData: Tauri APIが未設定です')
    localStorage.setItem(`tauri-secure:${key}`, value)
  }

  async loadSecureData(key: SecureStorageKey): Promise<string | null> {
    // TODO: Tauri Secure Storage APIを使用
    // return await invoke('load_secure_data', { key })
    console.warn('[TauriAdapter] loadSecureData: Tauri APIが未設定です')
    return localStorage.getItem(`tauri-secure:${key}`)
  }

  async deleteSecureData(key: SecureStorageKey): Promise<void> {
    // TODO: Tauri Secure Storage APIを使用
    // await invoke('delete_secure_data', { key })
    console.warn('[TauriAdapter] deleteSecureData: Tauri APIが未設定です')
    localStorage.removeItem(`tauri-secure:${key}`)
  }

  async selectFile(options?: FileSelectOptions): Promise<SelectedFile[] | null> {
    // TODO: Tauri Dialog APIを使用
    // const selected = await dialog.open({
    //   multiple: options?.multiple,
    //   filters: options?.accept?.map(ext => ({ name: ext, extensions: [ext.replace('.', '')] })),
    //   directory: options?.directory,
    // })
    console.warn('[TauriAdapter] selectFile: Tauri APIが未設定です')

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
    // TODO: Tauri FS APIを使用
    // const path = await dialog.save({ defaultPath: filename })
    // if (path) {
    //   await fs.writeBinaryFile(path, data)
    //   return path
    // }
    console.warn('[TauriAdapter] saveFile: Tauri APIが未設定です')
    return null
  }

  async getAppDataPath(): Promise<string> {
    // TODO: Tauri Path APIを使用
    // return await path.appDataDir()
    console.warn('[TauriAdapter] getAppDataPath: Tauri APIが未設定です')
    return '/app-data'
  }

  async showNotification(title: string, body: string): Promise<void> {
    // TODO: Tauri Notification APIを使用
    // await notification.sendNotification({ title, body })
    console.warn('[TauriAdapter] showNotification: Tauri APIが未設定です')
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  }

  async copyToClipboard(text: string): Promise<void> {
    // TODO: Tauri Clipboard APIを使用
    // await clipboard.writeText(text)
    console.warn('[TauriAdapter] copyToClipboard: Tauri APIが未設定です')
    await navigator.clipboard.writeText(text)
  }

  async openExternalUrl(url: string): Promise<void> {
    // TODO: Tauri Shell APIを使用
    // await shell.open(url)
    console.warn('[TauriAdapter] openExternalUrl: Tauri APIが未設定です')
    window.open(url, '_blank')
  }
}

/**
 * Tauri Adapter のシングルトンインスタンス
 */
export const tauriAdapter = new TauriAdapterImpl()
