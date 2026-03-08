import { useState, useEffect } from 'react'
import { useAuthStore } from '@/auth/authStore'
import type { UIConfig } from '@/types'

interface SettingsProps {
  isOpen: boolean
  onClose: () => void
  config: {
    ui: UIConfig
  }
  onSave: (config: { ui?: Partial<UIConfig> }) => void
}

/**
 * 設定パネル コンポーネント
 */
export function Settings({ isOpen, onClose, config, onSave }: SettingsProps) {
  const isAdmin = useAuthStore((s) => s.isAdmin)

  // UI設定のローカル状態
  const [theme, setTheme] = useState<'light' | 'dark'>(config.ui.theme)
  const [fontSize, setFontSize] = useState(config.ui.fontSize)
  const [developerMode, setDeveloperMode] = useState(config.ui.developerMode)

  const [isSaving, setIsSaving] = useState(false)

  // 設定が変更された時にローカル状態を更新
  useEffect(() => {
    setTheme(config.ui.theme)
    setFontSize(config.ui.fontSize)
    setDeveloperMode(config.ui.developerMode)
  }, [config])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      onSave({
        ui: {
          theme,
          fontSize,
          developerMode,
        },
      })

      onClose()
    } catch (error) {
      console.error('設定の保存に失敗:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    // 状態をリセット
    setTheme(config.ui.theme)
    setFontSize(config.ui.fontSize)
    setDeveloperMode(config.ui.developerMode)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      data-testid="settings-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancel()
      }}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden"
        data-testid="settings-panel"
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            設定
          </h2>
          <button
            onClick={handleCancel}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
            data-testid="close-button"
          >
            <svg
              className="w-5 h-5 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* コンテンツ */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          <div className="space-y-8">
            {/* 表示設定セクション */}
            <div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4" data-testid="display-section-title">
                表示設定
              </h3>
              <div className="space-y-6">
                {/* テーマ */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    テーマ
                  </label>
                  <div className="flex gap-4">
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="theme"
                        value="light"
                        checked={theme === 'light'}
                        onChange={() => setTheme('light')}
                        className="mr-2"
                        data-testid="theme-light"
                      />
                      <span className="text-gray-900 dark:text-gray-100">ライト</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="theme"
                        value="dark"
                        checked={theme === 'dark'}
                        onChange={() => setTheme('dark')}
                        className="mr-2"
                        data-testid="theme-dark"
                      />
                      <span className="text-gray-900 dark:text-gray-100">ダーク</span>
                    </label>
                  </div>
                </div>

                {/* フォントサイズ */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    フォントサイズ: {fontSize}px
                  </label>
                  <input
                    type="range"
                    min="12"
                    max="24"
                    step="1"
                    value={fontSize}
                    onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
                    className="w-full"
                    data-testid="font-size-slider"
                  />
                </div>
              </div>
            </div>

            {/* その他セクション */}
            {isAdmin && (
              <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4" data-testid="other-section-title">
                  その他
                </h3>
                <div className="space-y-4">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        開発者モード
                      </span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        有効にすると PoC ボタンが表示されます
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={developerMode}
                      onChange={(e) => setDeveloperMode(e.target.checked)}
                      className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      data-testid="developer-mode-toggle"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* フッター */}
        <div className="flex justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
            data-testid="cancel-button"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
            data-testid="save-button"
          >
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
