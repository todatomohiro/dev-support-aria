import { useState, useEffect } from 'react'
import type { LLMConfig, UIConfig, LLMProvider } from '@/types'
import { platformAdapter } from '@/platform'

interface SettingsProps {
  isOpen: boolean
  onClose: () => void
  config: {
    llm: LLMConfig
    ui: UIConfig
  }
  onSave: (config: { llm: Partial<LLMConfig>; ui: Partial<UIConfig> }) => void
}

/**
 * 設定パネル コンポーネント
 */
export function Settings({ isOpen, onClose, config, onSave }: SettingsProps) {
  // ローカル状態
  const [provider, setProvider] = useState<LLMProvider>(config.llm.provider)
  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [claudeApiKey, setClaudeApiKey] = useState('')
  const [systemPrompt, setSystemPrompt] = useState(config.llm.systemPrompt)
  const [temperature, setTemperature] = useState(config.llm.temperature)
  const [maxTokens, setMaxTokens] = useState(config.llm.maxTokens)
  const [theme, setTheme] = useState<'light' | 'dark'>(config.ui.theme)
  const [fontSize, setFontSize] = useState(config.ui.fontSize)
  const [characterSize, setCharacterSize] = useState(config.ui.characterSize)
  const [activeTab, setActiveTab] = useState<'api' | 'llm' | 'ui'>('api')
  const [isSaving, setIsSaving] = useState(false)
  const [showGeminiKey, setShowGeminiKey] = useState(false)
  const [showClaudeKey, setShowClaudeKey] = useState(false)

  // APIキーをセキュアストレージから読み込む
  useEffect(() => {
    const loadApiKeys = async () => {
      try {
        const gemini = await platformAdapter.loadSecureData('gemini-api-key')
        const claude = await platformAdapter.loadSecureData('claude-api-key')
        if (gemini) setGeminiApiKey(gemini)
        if (claude) setClaudeApiKey(claude)
      } catch (error) {
        console.error('APIキーの読み込みに失敗:', error)
      }
    }
    if (isOpen) {
      loadApiKeys()
    }
  }, [isOpen])

  // 設定が変更された時にローカル状態を更新
  useEffect(() => {
    setProvider(config.llm.provider)
    setSystemPrompt(config.llm.systemPrompt)
    setTemperature(config.llm.temperature)
    setMaxTokens(config.llm.maxTokens)
    setTheme(config.ui.theme)
    setFontSize(config.ui.fontSize)
    setCharacterSize(config.ui.characterSize)
  }, [config])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      // APIキーをセキュアストレージに保存
      if (geminiApiKey) {
        await platformAdapter.saveSecureData('gemini-api-key', geminiApiKey)
      } else {
        await platformAdapter.deleteSecureData('gemini-api-key')
      }

      if (claudeApiKey) {
        await platformAdapter.saveSecureData('claude-api-key', claudeApiKey)
      } else {
        await platformAdapter.deleteSecureData('claude-api-key')
      }

      // 設定を保存（APIキーは現在選択中のプロバイダーのものを使用）
      const currentApiKey = provider === 'gemini' ? geminiApiKey : claudeApiKey

      onSave({
        llm: {
          provider,
          apiKey: currentApiKey,
          systemPrompt,
          temperature,
          maxTokens,
        },
        ui: {
          theme,
          fontSize,
          characterSize,
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
    setProvider(config.llm.provider)
    setSystemPrompt(config.llm.systemPrompt)
    setTemperature(config.llm.temperature)
    setMaxTokens(config.llm.maxTokens)
    setTheme(config.ui.theme)
    setFontSize(config.ui.fontSize)
    setCharacterSize(config.ui.characterSize)
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

        {/* タブ */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          <TabButton
            active={activeTab === 'api'}
            onClick={() => setActiveTab('api')}
          >
            APIキー
          </TabButton>
          <TabButton
            active={activeTab === 'llm'}
            onClick={() => setActiveTab('llm')}
          >
            LLM設定
          </TabButton>
          <TabButton
            active={activeTab === 'ui'}
            onClick={() => setActiveTab('ui')}
          >
            表示設定
          </TabButton>
        </div>

        {/* コンテンツ */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {activeTab === 'api' && (
            <div className="space-y-6">
              {/* プロバイダー選択 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  使用するLLMプロバイダー
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="provider"
                      value="gemini"
                      checked={provider === 'gemini'}
                      onChange={() => setProvider('gemini')}
                      className="mr-2"
                      data-testid="provider-gemini"
                    />
                    <span className="text-gray-900 dark:text-gray-100">Gemini</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="provider"
                      value="claude"
                      checked={provider === 'claude'}
                      onChange={() => setProvider('claude')}
                      className="mr-2"
                      data-testid="provider-claude"
                    />
                    <span className="text-gray-900 dark:text-gray-100">Claude</span>
                  </label>
                </div>
              </div>

              {/* Gemini APIキー */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Gemini APIキー
                </label>
                <div className="flex gap-2">
                  <input
                    type={showGeminiKey ? 'text' : 'password'}
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    data-testid="gemini-api-key-input"
                  />
                  <button
                    onClick={() => setShowGeminiKey(!showGeminiKey)}
                    className="px-3 py-2 bg-gray-100 dark:bg-gray-600 rounded-lg"
                    data-testid="toggle-gemini-visibility"
                  >
                    {showGeminiKey ? '隠す' : '表示'}
                  </button>
                </div>
              </div>

              {/* Claude APIキー */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Claude APIキー
                </label>
                <div className="flex gap-2">
                  <input
                    type={showClaudeKey ? 'text' : 'password'}
                    value={claudeApiKey}
                    onChange={(e) => setClaudeApiKey(e.target.value)}
                    placeholder="sk-ant-..."
                    className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    data-testid="claude-api-key-input"
                  />
                  <button
                    onClick={() => setShowClaudeKey(!showClaudeKey)}
                    className="px-3 py-2 bg-gray-100 dark:bg-gray-600 rounded-lg"
                    data-testid="toggle-claude-visibility"
                  >
                    {showClaudeKey ? '隠す' : '表示'}
                  </button>
                </div>
              </div>

              <p className="text-sm text-gray-500 dark:text-gray-400">
                APIキーはセキュアストレージに安全に保存されます
              </p>
            </div>
          )}

          {activeTab === 'llm' && (
            <div className="space-y-6">
              {/* システムプロンプト */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  システムプロンプト
                </label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="キャラクターの性格や応答スタイルを設定..."
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 p-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={4}
                  data-testid="system-prompt-input"
                />
              </div>

              {/* Temperature */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Temperature: {temperature.toFixed(1)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  className="w-full"
                  data-testid="temperature-slider"
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>正確性重視 (0)</span>
                  <span>創造性重視 (2)</span>
                </div>
              </div>

              {/* Max Tokens */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  最大トークン数: {maxTokens}
                </label>
                <input
                  type="range"
                  min="256"
                  max="4096"
                  step="256"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(parseInt(e.target.value, 10))}
                  className="w-full"
                  data-testid="max-tokens-slider"
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>短い (256)</span>
                  <span>長い (4096)</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ui' && (
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

              {/* キャラクターサイズ */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  キャラクターサイズ: {characterSize}%
                </label>
                <input
                  type="range"
                  min="50"
                  max="150"
                  step="10"
                  value={characterSize}
                  onChange={(e) => setCharacterSize(parseInt(e.target.value, 10))}
                  className="w-full"
                  data-testid="character-size-slider"
                />
              </div>
            </div>
          )}
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

/**
 * タブボタン コンポーネント
 */
function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 font-medium transition-colors ${
        active
          ? 'text-blue-600 border-b-2 border-blue-600'
          : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
      }`}
      data-testid={`tab-${children?.toString().toLowerCase().replace(/\s+/g, '-')}`}
    >
      {children}
    </button>
  )
}
