import { useState, useEffect } from 'react'
import type { UserProfile } from '@/types'

interface ProfileModalProps {
  isOpen: boolean
  onClose: () => void
  profile: UserProfile
  onSave: (profile: Partial<UserProfile>) => void
}

/**
 * プロフィール設定モーダル コンポーネント
 */
export function ProfileModal({ isOpen, onClose, profile, onSave }: ProfileModalProps) {
  const [nickname, setNickname] = useState(profile.nickname)
  const [honorific, setHonorific] = useState<UserProfile['honorific']>(profile.honorific)
  const [gender, setGender] = useState<UserProfile['gender']>(profile.gender)
  const [aiName, setAiName] = useState(profile.aiName ?? '')
  const [isSaving, setIsSaving] = useState(false)

  // 設定が変更された時にローカル状態を更新
  useEffect(() => {
    setNickname(profile.nickname)
    setHonorific(profile.honorific)
    setGender(profile.gender)
    setAiName(profile.aiName ?? '')
  }, [profile])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      onSave({ nickname, honorific, gender, aiName })
      onClose()
    } catch (error) {
      console.error('プロフィールの保存に失敗:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setNickname(profile.nickname)
    setHonorific(profile.honorific)
    setGender(profile.gender)
    setAiName(profile.aiName ?? '')
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      data-testid="profile-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancel()
      }}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden"
        data-testid="profile-panel"
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            プロフィール
          </h2>
          <button
            onClick={handleCancel}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
            data-testid="profile-close-button"
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
          <div className="space-y-4">
            {/* ニックネーム */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                ニックネーム
              </label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value.slice(0, 20))}
                maxLength={20}
                placeholder="名前を入力"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                data-testid="nickname-input"
              />
            </div>

            {/* 敬称 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                敬称
              </label>
              <select
                value={honorific}
                onChange={(e) => setHonorific(e.target.value as UserProfile['honorific'])}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                data-testid="honorific-select"
              >
                <option value="">なし</option>
                <option value="さん">さん</option>
                <option value="くん">くん</option>
                <option value="様">様</option>
              </select>
            </div>

            {/* 性別 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                性別
              </label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value as UserProfile['gender'])}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                data-testid="gender-select"
              >
                <option value="">未設定</option>
                <option value="female">女性</option>
                <option value="male">男性</option>
              </select>
            </div>

            {/* AIネーム */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                AIネーム
              </label>
              <input
                type="text"
                value={aiName}
                onChange={(e) => setAiName(e.target.value.slice(0, 20))}
                maxLength={20}
                placeholder="AIの名前を入力"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                data-testid="ai-name-input"
              />
            </div>
          </div>
        </div>

        {/* フッター */}
        <div className="flex justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
            data-testid="profile-cancel-button"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
            data-testid="profile-save-button"
          >
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
