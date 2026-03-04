import { useState } from 'react'
import type { TopicCategory, TopicSubcategory } from '@/types'
import { TOPIC_CATEGORIES } from '@/types'

interface CategorySelectProps {
  onSelect: (category: TopicCategory, subcategory?: TopicSubcategory) => void
}

/**
 * チャット画面内の2段階カテゴリ選択カード（横スクロール）
 */
export function CategorySelect({ onSelect }: CategorySelectProps) {
  const [selectedCategory, setSelectedCategory] = useState<TopicCategory | null>(null)

  /** 親カテゴリクリック */
  const handleCategoryClick = (cat: TopicCategory) => {
    if (cat.subcategories && cat.subcategories.length > 0) {
      setSelectedCategory(cat)
    } else {
      onSelect(cat)
    }
  }

  /** サブカテゴリクリック */
  const handleSubcategoryClick = (sub: TopicSubcategory) => {
    if (selectedCategory) {
      onSelect(selectedCategory, sub)
    }
  }

  /** 戻るボタン */
  const handleBack = () => {
    setSelectedCategory(null)
  }

  // サブカテゴリ選択画面
  if (selectedCategory) {
    return (
      <div className="px-4 py-8" data-testid="category-select">
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={handleBack}
            className="text-sm text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 transition-colors"
            data-testid="category-back"
          >
            &larr; 戻る
          </button>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {selectedCategory.label}
          </h2>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
          {selectedCategory.subcategories!.map((sub) => (
            <button
              key={sub.key}
              onClick={() => handleSubcategoryClick(sub)}
              className="shrink-0 w-44 px-5 py-3 text-sm font-medium text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-full hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-sm transition-all snap-start"
              data-testid={`subcategory-card-${sub.key}`}
            >
              {sub.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // 親カテゴリ選択画面
  return (
    <div className="px-4 py-8" data-testid="category-select">
      <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">
        何から会話をはじめますか？
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
        {TOPIC_CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => handleCategoryClick(cat)}
            className="shrink-0 w-44 px-5 py-3 text-sm font-medium text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-full hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-sm transition-all snap-start"
            data-testid={`category-card-${cat.key}`}
          >
            {cat.label}
          </button>
        ))}
      </div>
    </div>
  )
}
