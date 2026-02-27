import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { webAdapter } from '../webAdapter'
import type { PlatformAdapter } from '../types'

// Tauri Store モック（共有 Map でラウンドトリップ対応）
const tauriStoreData = new Map<string, unknown>()
const mockStore = {
  get: vi.fn(async (key: string) => tauriStoreData.get(key) ?? null),
  set: vi.fn(async (key: string, value: unknown) => { tauriStoreData.set(key, value) }),
  delete: vi.fn(async (key: string) => { tauriStoreData.delete(key) }),
  save: vi.fn(async () => {}),
}
vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn(async () => mockStore),
}))

// Tauri Opener モック
const mockOpenUrl = vi.fn(async () => {})
vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: mockOpenUrl,
}))

// Tauri Path API モック
vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(async () => '/Users/test/Library/Application Support/com.butler-assistant.app'),
}))

// Capacitor Preferences モック（共有 Map でラウンドトリップ対応）
const capacitorPrefsData = new Map<string, string>()
const mockPreferences = {
  set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
    capacitorPrefsData.set(key, value)
  }),
  get: vi.fn(async ({ key }: { key: string }) => ({
    value: capacitorPrefsData.get(key) ?? null,
  })),
  remove: vi.fn(async ({ key }: { key: string }) => {
    capacitorPrefsData.delete(key)
  }),
}
vi.mock('@capacitor/preferences', () => ({
  Preferences: mockPreferences,
}))

// Capacitor Browser モック
const mockBrowserOpen = vi.fn(async () => {})
vi.mock('@capacitor/browser', () => ({
  Browser: { open: mockBrowserOpen },
}))

// Capacitor Clipboard モック
const mockClipboardWrite = vi.fn(async () => {})
vi.mock('@capacitor/clipboard', () => ({
  Clipboard: { write: mockClipboardWrite },
}))

// tauriAdapter / capacitorAdapter はモック設定後に import する
const { tauriAdapter } = await import('../tauriAdapter')
const { capacitorAdapter } = await import('../capacitorAdapter')

describe('Platform Adapters', () => {
  describe('WebAdapter', () => {
    const adapter: PlatformAdapter = webAdapter

    beforeEach(() => {
      localStorage.clear()
    })

    afterEach(() => {
      localStorage.clear()
    })

    describe('getPlatform', () => {
      it('webを返す', () => {
        expect(adapter.getPlatform()).toBe('web')
      })
    })

    describe('セキュアストレージ', () => {
      it('データを保存して読み込める', async () => {
        await adapter.saveSecureData('gemini-api-key', 'test-api-key-123')
        const result = await adapter.loadSecureData('gemini-api-key')
        expect(result).toBe('test-api-key-123')
      })

      it('存在しないキーはnullを返す', async () => {
        const result = await adapter.loadSecureData('claude-api-key')
        expect(result).toBeNull()
      })

      it('データを削除できる', async () => {
        await adapter.saveSecureData('gemini-api-key', 'test-value')
        await adapter.deleteSecureData('gemini-api-key')
        const result = await adapter.loadSecureData('gemini-api-key')
        expect(result).toBeNull()
      })

      it('日本語を含む値を保存・読み込みできる', async () => {
        const value = '日本語テスト123'
        await adapter.saveSecureData('app-settings', value)
        const result = await adapter.loadSecureData('app-settings')
        expect(result).toBe(value)
      })

      it('特殊文字を含む値を保存・読み込みできる', async () => {
        const value = '!@#$%^&*()_+{}|:"<>?`-=[]\\;\',./~'
        await adapter.saveSecureData('app-settings', value)
        const result = await adapter.loadSecureData('app-settings')
        expect(result).toBe(value)
      })
    })

    describe('getAppDataPath', () => {
      it('パスを返す', async () => {
        const path = await adapter.getAppDataPath()
        expect(typeof path).toBe('string')
        expect(path.length).toBeGreaterThan(0)
      })
    })

    describe('copyToClipboard', () => {
      it('クリップボードにコピーできる', async () => {
        // navigator.clipboard のモック
        const writeTextMock = vi.fn().mockResolvedValue(undefined)
        Object.assign(navigator, {
          clipboard: { writeText: writeTextMock },
        })

        await adapter.copyToClipboard('test text')
        expect(writeTextMock).toHaveBeenCalledWith('test text')
      })
    })

    describe('openExternalUrl', () => {
      it('新しいウィンドウでURLを開く', async () => {
        const openMock = vi.fn()
        vi.stubGlobal('open', openMock)

        await adapter.openExternalUrl('https://example.com')
        expect(openMock).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')

        vi.unstubAllGlobals()
      })
    })
  })

  describe('TauriAdapter', () => {
    const adapter: PlatformAdapter = tauriAdapter

    beforeEach(() => {
      tauriStoreData.clear()
      vi.clearAllMocks()
    })

    describe('getPlatform', () => {
      it('tauriを返す', () => {
        expect(adapter.getPlatform()).toBe('tauri')
      })
    })

    describe('セキュアストレージ（Tauri Store）', () => {
      it('データを保存して読み込める', async () => {
        await adapter.saveSecureData('gemini-api-key', 'tauri-test-key')
        const result = await adapter.loadSecureData('gemini-api-key')
        expect(result).toBe('tauri-test-key')
      })

      it('保存時にstore.setとstore.saveが呼ばれる', async () => {
        await adapter.saveSecureData('gemini-api-key', 'test-value')
        expect(mockStore.set).toHaveBeenCalledWith('gemini-api-key', 'test-value')
        expect(mockStore.save).toHaveBeenCalled()
      })

      it('読み込み時にstore.getが呼ばれる', async () => {
        await adapter.loadSecureData('claude-api-key')
        expect(mockStore.get).toHaveBeenCalledWith('claude-api-key')
      })

      it('存在しないキーはnullを返す', async () => {
        const result = await adapter.loadSecureData('claude-api-key')
        expect(result).toBeNull()
      })

      it('データを削除できる', async () => {
        await adapter.saveSecureData('gemini-api-key', 'to-delete')
        await adapter.deleteSecureData('gemini-api-key')
        const result = await adapter.loadSecureData('gemini-api-key')
        expect(result).toBeNull()
      })

      it('削除時にstore.deleteとstore.saveが呼ばれる', async () => {
        await adapter.deleteSecureData('app-settings')
        expect(mockStore.delete).toHaveBeenCalledWith('app-settings')
        expect(mockStore.save).toHaveBeenCalled()
      })
    })

    describe('getAppDataPath', () => {
      it('Tauri Path APIからパスを取得する', async () => {
        const path = await adapter.getAppDataPath()
        expect(path).toBe('/Users/test/Library/Application Support/com.butler-assistant.app')
      })
    })

    describe('openExternalUrl', () => {
      it('Tauri Opener APIでURLを開く', async () => {
        await adapter.openExternalUrl('https://example.com')
        expect(mockOpenUrl).toHaveBeenCalledWith('https://example.com')
      })
    })

    describe('saveFile', () => {
      it('ファイル名を返す', async () => {
        const result = await adapter.saveFile('test.txt', 'content')
        expect(result).toBe('test.txt')
      })
    })
  })

  describe('CapacitorAdapter', () => {
    const adapter: PlatformAdapter = capacitorAdapter

    beforeEach(() => {
      capacitorPrefsData.clear()
      vi.clearAllMocks()
    })

    describe('getPlatform', () => {
      it('capacitorを返す', () => {
        expect(adapter.getPlatform()).toBe('capacitor')
      })
    })

    describe('セキュアストレージ（Capacitor Preferences）', () => {
      it('データを保存して読み込める', async () => {
        await adapter.saveSecureData('claude-api-key', 'capacitor-test-key')
        const result = await adapter.loadSecureData('claude-api-key')
        expect(result).toBe('capacitor-test-key')
      })

      it('保存時にPreferences.setが呼ばれる', async () => {
        await adapter.saveSecureData('gemini-api-key', 'test-value')
        expect(mockPreferences.set).toHaveBeenCalledWith({
          key: 'gemini-api-key',
          value: 'test-value',
        })
      })

      it('読み込み時にPreferences.getが呼ばれる', async () => {
        await adapter.loadSecureData('claude-api-key')
        expect(mockPreferences.get).toHaveBeenCalledWith({ key: 'claude-api-key' })
      })

      it('存在しないキーはnullを返す', async () => {
        const result = await adapter.loadSecureData('claude-api-key')
        expect(result).toBeNull()
      })

      it('データを削除できる', async () => {
        await adapter.saveSecureData('gemini-api-key', 'to-delete')
        await adapter.deleteSecureData('gemini-api-key')
        const result = await adapter.loadSecureData('gemini-api-key')
        expect(result).toBeNull()
      })

      it('削除時にPreferences.removeが呼ばれる', async () => {
        await adapter.deleteSecureData('app-settings')
        expect(mockPreferences.remove).toHaveBeenCalledWith({ key: 'app-settings' })
      })
    })

    describe('getAppDataPath', () => {
      it('Capacitor用の固定パスを返す', async () => {
        const path = await adapter.getAppDataPath()
        expect(path).toBe('capacitor://app-data')
      })
    })

    describe('openExternalUrl', () => {
      it('Capacitor Browser APIでURLを開く', async () => {
        await adapter.openExternalUrl('https://example.com')
        expect(mockBrowserOpen).toHaveBeenCalledWith({ url: 'https://example.com' })
      })
    })

    describe('copyToClipboard', () => {
      it('Capacitor Clipboard APIでコピーする', async () => {
        await adapter.copyToClipboard('test text')
        expect(mockClipboardWrite).toHaveBeenCalledWith({ string: 'test text' })
      })
    })

    describe('saveFile', () => {
      it('ファイル名を返す', async () => {
        const result = await adapter.saveFile('test.txt', 'content')
        expect(result).toBe('test.txt')
      })
    })
  })

  describe('アダプター間の一貫性', () => {
    const adapters: { name: string; adapter: PlatformAdapter }[] = [
      { name: 'web', adapter: webAdapter },
      { name: 'tauri', adapter: tauriAdapter },
      { name: 'capacitor', adapter: capacitorAdapter },
    ]

    beforeEach(() => {
      localStorage.clear()
      tauriStoreData.clear()
      capacitorPrefsData.clear()
      vi.clearAllMocks()
    })

    afterEach(() => {
      localStorage.clear()
      tauriStoreData.clear()
      capacitorPrefsData.clear()
    })

    it.each(adapters)('$name: セキュアストレージのラウンドトリップ', async ({ adapter }) => {
      const testValue = 'round-trip-test-value'
      await adapter.saveSecureData('app-settings', testValue)
      const result = await adapter.loadSecureData('app-settings')
      expect(result).toBe(testValue)
    })

    it.each(adapters)('$name: 削除後はnullを返す', async ({ adapter }) => {
      await adapter.saveSecureData('app-settings', 'to-be-deleted')
      await adapter.deleteSecureData('app-settings')
      const result = await adapter.loadSecureData('app-settings')
      expect(result).toBeNull()
    })

    it.each(adapters)('$name: getPlatformが文字列を返す', ({ adapter }) => {
      const platform = adapter.getPlatform()
      expect(typeof platform).toBe('string')
      expect(['web', 'tauri', 'capacitor']).toContain(platform)
    })

    it.each(adapters)('$name: getAppDataPathがパスを返す', async ({ adapter }) => {
      const path = await adapter.getAppDataPath()
      expect(typeof path).toBe('string')
    })
  })
})
