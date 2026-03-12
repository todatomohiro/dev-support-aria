import type { PlatformAdapter, Platform } from './types'
import { webAdapter } from './webAdapter'
import { capacitorAdapter } from './capacitorAdapter'

export type { PlatformAdapter, Platform, SecureStorageKey, FileSelectOptions, SelectedFile } from './types'

/**
 * 現在のプラットフォームを検出
 */
function detectPlatform(): Platform {
  // Capacitor環境の検出
  if (
    typeof window !== 'undefined' &&
    'Capacitor' in window &&
    (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
  ) {
    return 'capacitor'
  }

  // デフォルトはWeb
  return 'web'
}

/**
 * プラットフォームに応じたアダプターを取得
 */
function getAdapter(platform: Platform): PlatformAdapter {
  switch (platform) {
    case 'capacitor':
      return capacitorAdapter
    case 'web':
    default:
      return webAdapter
  }
}

/**
 * 現在のプラットフォーム
 */
export const currentPlatform: Platform = detectPlatform()

/**
 * プラットフォームアダプターのシングルトンインスタンス
 */
export const platformAdapter: PlatformAdapter = getAdapter(currentPlatform)

/**
 * プラットフォーム固有の機能が利用可能かどうかをチェック
 */
export function isPlatformFeatureAvailable(feature: 'secureStorage' | 'fileSystem' | 'notifications'): boolean {
  switch (feature) {
    case 'secureStorage':
      // Capacitorでは完全なセキュアストレージが利用可能
      return currentPlatform !== 'web'
    case 'fileSystem':
      // 全プラットフォームで何らかのファイルアクセスが可能
      return true
    case 'notifications':
      // Web Notifications APIまたはネイティブ通知が利用可能
      return 'Notification' in window || currentPlatform !== 'web'
    default:
      return false
  }
}

/**
 * デバッグ用: プラットフォーム情報を出力
 */
export function logPlatformInfo(): void {
  console.log('[Platform] Current platform:', currentPlatform)
  console.log('[Platform] Features:', {
    secureStorage: isPlatformFeatureAvailable('secureStorage'),
    fileSystem: isPlatformFeatureAvailable('fileSystem'),
    notifications: isPlatformFeatureAvailable('notifications'),
  })
}
