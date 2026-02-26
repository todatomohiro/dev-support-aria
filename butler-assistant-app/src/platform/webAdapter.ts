import type {
  PlatformAdapter,
  Platform,
  SecureStorageKey,
  FileSelectOptions,
  SelectedFile,
} from './types'

/**
 * セキュアストレージのプレフィックス
 */
const SECURE_STORAGE_PREFIX = 'butler-secure:'

/**
 * Web Platform Adapter
 * ブラウザ環境用のプラットフォーム実装
 */
class WebAdapterImpl implements PlatformAdapter {
  getPlatform(): Platform {
    return 'web'
  }

  async saveSecureData(key: SecureStorageKey, value: string): Promise<void> {
    // Web環境ではlocalStorageを使用（本番環境では暗号化を検討）
    // 注意: Webブラウザでは完全にセキュアな保存は困難
    const encodedValue = btoa(encodeURIComponent(value))
    localStorage.setItem(`${SECURE_STORAGE_PREFIX}${key}`, encodedValue)
  }

  async loadSecureData(key: SecureStorageKey): Promise<string | null> {
    const encodedValue = localStorage.getItem(`${SECURE_STORAGE_PREFIX}${key}`)
    if (!encodedValue) {
      return null
    }
    try {
      return decodeURIComponent(atob(encodedValue))
    } catch {
      return null
    }
  }

  async deleteSecureData(key: SecureStorageKey): Promise<void> {
    localStorage.removeItem(`${SECURE_STORAGE_PREFIX}${key}`)
  }

  async selectFile(options?: FileSelectOptions): Promise<SelectedFile[] | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = options?.multiple ?? false

      if (options?.accept && options.accept.length > 0) {
        input.accept = options.accept.join(',')
      }

      // webkitdirectory属性でディレクトリ選択（一部ブラウザのみ対応）
      if (options?.directory) {
        input.setAttribute('webkitdirectory', '')
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
            path: file.webkitRelativePath || file.name,
            size: file.size,
            type: file.type,
            data,
          })
        }

        resolve(selectedFiles)
      }

      input.oncancel = () => {
        resolve(null)
      }

      input.click()
    })
  }

  async saveFile(filename: string, data: ArrayBuffer | string): Promise<string | null> {
    try {
      const blob =
        typeof data === 'string'
          ? new Blob([data], { type: 'text/plain' })
          : new Blob([data])

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      return filename
    } catch {
      return null
    }
  }

  async getAppDataPath(): Promise<string> {
    // Web環境ではローカルパスは使用できない
    return '/app-data'
  }

  async showNotification(title: string, body: string): Promise<void> {
    // Web Notifications APIを使用
    if (!('Notification' in window)) {
      console.warn('このブラウザは通知をサポートしていません')
      return
    }

    const permission = await Notification.requestPermission()
    if (permission === 'granted') {
      new Notification(title, { body })
    }
  }

  async copyToClipboard(text: string): Promise<void> {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text)
    } else {
      // フォールバック: execCommand
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
  }

  async openExternalUrl(url: string): Promise<void> {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

/**
 * Web Adapter のシングルトンインスタンス
 */
export const webAdapter = new WebAdapterImpl()
