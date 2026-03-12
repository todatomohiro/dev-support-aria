import { useState, useCallback, useRef, useEffect } from 'react'
import { AVAILABLE_MODELS } from '@/types'
import type { ModelKey, UsageInfo } from '@/types'
import { useAppStore } from '@/stores'

interface ModelSelectorProps {
  /** 現在選択中のモデルキー */
  modelKey: ModelKey
  /** モデル変更時のコールバック */
  onChange: (modelKey: ModelKey) => void
}

/**
 * モデル選択ドロップダウンコンポーネント
 *
 * ピル型ボタンをクリックするとドロップダウンが開き、モデルを選択できる。
 * 無料プランでは利用不可のモデルにロックアイコンを表示。
 */
export function ModelSelector({ modelKey, onChange }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const usageInfo = useAppStore((s) => s.usageInfo)

  const currentModel = AVAILABLE_MODELS.find((m) => m.key === modelKey) ?? AVAILABLE_MODELS[0]

  /** モデルがプランで利用可能かチェック */
  const isModelAllowed = (key: ModelKey, usage: UsageInfo | null): boolean => {
    if (!usage) return true
    if (usage.plan === 'paid') return true
    return usage.allowedModels.includes(key)
  }

  /** ドロップダウン外クリックで閉じる */
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  /** モデル選択 */
  const handleSelect = useCallback((key: ModelKey) => {
    if (!isModelAllowed(key, usageInfo)) return
    if (key !== modelKey) {
      onChange(key)
    }
    setIsOpen(false)
  }, [modelKey, onChange, usageInfo])

  return (
    <div ref={containerRef} className="relative" data-testid="model-selector">
      {/* ピル型トグルボタン */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
        data-testid="model-selector-button"
      >
        {currentModel.label}
        <svg className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* ドロップダウン */}
      {isOpen && (
        <div className="absolute right-0 bottom-full mb-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-50" data-testid="model-selector-dropdown">
          {AVAILABLE_MODELS.map((model) => {
            const allowed = isModelAllowed(model.key, usageInfo)
            return (
              <button
                key={model.key}
                onClick={() => handleSelect(model.key)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left first:rounded-t-lg last:rounded-b-lg transition-colors ${
                  allowed
                    ? 'hover:bg-gray-50 dark:hover:bg-gray-700'
                    : 'opacity-50 cursor-not-allowed'
                }`}
                data-testid={`model-option-${model.key}`}
              >
                <span className="w-4 text-center text-blue-500">
                  {model.key === modelKey ? '✓' : !allowed ? '🔒' : ''}
                </span>
                <div>
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    {model.label}
                    {!allowed && <span className="ml-1 text-xs text-amber-500">有料</span>}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{model.description}</div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
