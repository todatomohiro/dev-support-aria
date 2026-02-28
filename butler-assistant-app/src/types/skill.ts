/**
 * スキル接続情報
 */
export interface SkillConnection {
  service: string
  connectedAt: number
}

/**
 * 利用可能なスキル定義
 */
export interface SkillDefinition {
  id: string
  name: string
  description: string
  icon: string
}

/**
 * 利用可能なスキル一覧
 */
export const AVAILABLE_SKILLS: SkillDefinition[] = [
  {
    id: 'google',
    name: 'Google カレンダー',
    description: 'チャットで予定の確認・作成ができます',
    icon: '📅',
  },
]
