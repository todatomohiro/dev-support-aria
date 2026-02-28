import { useState, useEffect, useCallback } from 'react'
import { groupService } from '@/services/groupService'
import { useGroupChatStore } from '@/stores/groupChatStore'
import { AddMemberModal } from './AddMemberModal'
import type { GroupMember } from '@/types'

interface GroupInfoPanelProps {
  groupId: string
  onClose: () => void
  onLeave: () => void
}

/**
 * グループ情報パネル
 *
 * メンバー一覧、メンバー追加、グループ退出を提供する。
 */
export function GroupInfoPanel({ groupId, onClose, onLeave }: GroupInfoPanelProps) {
  const [isLeaving, setIsLeaving] = useState(false)
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false)
  const activeMembers = useGroupChatStore((s) => s.activeMembers)
  const setActiveMembers = useGroupChatStore((s) => s.setActiveMembers)

  /** メンバー一覧を読み込み */
  const loadMembers = useCallback(async () => {
    try {
      const { members } = await groupService.getMembers(groupId)
      setActiveMembers(members)
    } catch (error) {
      console.error('[GroupInfoPanel] メンバー一覧取得エラー:', error)
    }
  }, [groupId, setActiveMembers])

  // マウント時にメンバーを読み込み
  useEffect(() => {
    loadMembers()
    return () => setActiveMembers([])
  }, [loadMembers, setActiveMembers])

  /** グループを退出 */
  const handleLeave = async () => {
    const confirmed = window.confirm('このグループを退出しますか？')
    if (!confirmed) return

    setIsLeaving(true)
    try {
      await groupService.leaveGroup(groupId)
      onLeave()
    } catch (error) {
      console.error('[GroupInfoPanel] グループ退出エラー:', error)
    } finally {
      setIsLeaving(false)
    }
  }

  /** メンバー追加後にリロード */
  const handleAddMemberClose = (added?: boolean) => {
    setIsAddMemberOpen(false)
    if (added) loadMembers()
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900" data-testid="group-info-panel">
      {/* ヘッダー */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          グループ情報
        </h3>
        <button
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* メンバー一覧 */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            メンバー ({activeMembers.length})
          </h4>
          <button
            onClick={() => setIsAddMemberOpen(true)}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            data-testid="add-member-button"
          >
            追加
          </button>
        </div>

        <ul className="space-y-1">
          {activeMembers.map((member: GroupMember) => (
            <li key={member.userId} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg">
              <div className="shrink-0 w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
                <span className="text-xs font-medium text-blue-600 dark:text-blue-300">
                  {member.nickname.charAt(0).toUpperCase()}
                </span>
              </div>
              <span className="text-sm text-gray-900 dark:text-gray-100 truncate">
                {member.nickname}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* グループ退出ボタン */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={handleLeave}
          disabled={isLeaving}
          className="w-full px-4 py-2 text-sm text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          data-testid="leave-group-button"
        >
          {isLeaving ? '退出中...' : 'グループを退出'}
        </button>
      </div>

      {/* メンバー追加モーダル */}
      <AddMemberModal
        isOpen={isAddMemberOpen}
        groupId={groupId}
        onClose={handleAddMemberClose}
      />
    </div>
  )
}
