import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { webAdapter } from '../webAdapter'
import { tauriAdapter } from '../tauriAdapter'
import { capacitorAdapter } from '../capacitorAdapter'
import type { PlatformAdapter } from '../types'

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
      localStorage.clear()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
      localStorage.clear()
      vi.restoreAllMocks()
    })

    describe('getPlatform', () => {
      it('tauriを返す', () => {
        expect(adapter.getPlatform()).toBe('tauri')
      })
    })

    describe('セキュアストレージ（フォールバック）', () => {
      it('データを保存して読み込める', async () => {
        await adapter.saveSecureData('gemini-api-key', 'tauri-test-key')
        const result = await adapter.loadSecureData('gemini-api-key')
        expect(result).toBe('tauri-test-key')
      })

      it('警告が出力される', async () => {
        await adapter.saveSecureData('gemini-api-key', 'test')
        expect(console.warn).toHaveBeenCalled()
      })
    })
  })

  describe('CapacitorAdapter', () => {
    const adapter: PlatformAdapter = capacitorAdapter

    beforeEach(() => {
      localStorage.clear()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
      localStorage.clear()
      vi.restoreAllMocks()
    })

    describe('getPlatform', () => {
      it('capacitorを返す', () => {
        expect(adapter.getPlatform()).toBe('capacitor')
      })
    })

    describe('セキュアストレージ（フォールバック）', () => {
      it('データを保存して読み込める', async () => {
        await adapter.saveSecureData('claude-api-key', 'capacitor-test-key')
        const result = await adapter.loadSecureData('claude-api-key')
        expect(result).toBe('capacitor-test-key')
      })

      it('警告が出力される', async () => {
        await adapter.saveSecureData('claude-api-key', 'test')
        expect(console.warn).toHaveBeenCalled()
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
      vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
      localStorage.clear()
      vi.restoreAllMocks()
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
