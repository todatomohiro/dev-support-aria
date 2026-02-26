/**
 * プラットフォーム種別
 */
export type Platform = 'web' | 'tauri' | 'capacitor'

/**
 * ファイル選択オプション
 */
export interface FileSelectOptions {
  multiple?: boolean
  accept?: string[]
  directory?: boolean
}

/**
 * 選択されたファイル情報
 */
export interface SelectedFile {
  name: string
  path: string
  size: number
  type: string
  data?: ArrayBuffer
}

/**
 * セキュアストレージのキー種別
 */
export type SecureStorageKey = 'gemini-api-key' | 'claude-api-key' | 'app-settings'

/**
 * プラットフォームアダプターインターフェース
 */
export interface PlatformAdapter {
  /**
   * プラットフォーム種別を取得
   */
  getPlatform(): Platform

  /**
   * セキュアデータを保存
   */
  saveSecureData(key: SecureStorageKey, value: string): Promise<void>

  /**
   * セキュアデータを読み込み
   */
  loadSecureData(key: SecureStorageKey): Promise<string | null>

  /**
   * セキュアデータを削除
   */
  deleteSecureData(key: SecureStorageKey): Promise<void>

  /**
   * ファイル選択ダイアログを表示
   */
  selectFile(options?: FileSelectOptions): Promise<SelectedFile[] | null>

  /**
   * ファイルを保存
   */
  saveFile(filename: string, data: ArrayBuffer | string): Promise<string | null>

  /**
   * アプリデータディレクトリのパスを取得
   */
  getAppDataPath(): Promise<string>

  /**
   * 通知を表示
   */
  showNotification(title: string, body: string): Promise<void>

  /**
   * クリップボードにコピー
   */
  copyToClipboard(text: string): Promise<void>

  /**
   * 外部URLを開く
   */
  openExternalUrl(url: string): Promise<void>
}
