import { useCallback } from 'react'
import { useAppStore } from '@/stores/appStore'

interface MotionPanelProps {
  onPlayMotion: (group: string, index: number) => void
  onPlayExpression: (name: string) => void
}

/** モーションタグ定義（管理画面と同一順序） */
const MOTION_TAGS = [
  { key: 'idle', label: 'idle（待機）' },
  { key: 'happy', label: 'happy（喜び）' },
  { key: 'thinking', label: 'thinking（考え中）' },
  { key: 'surprised', label: 'surprised（驚き）' },
  { key: 'sad', label: 'sad（悲しみ）' },
  { key: 'embarrassed', label: 'embarrassed（照れ）' },
  { key: 'troubled', label: 'troubled（困惑）' },
  { key: 'angry', label: 'angry（怒り）' },
  { key: 'error', label: 'error（エラー）' },
  { key: 'motion1', label: 'motion1（モーション1）' },
  { key: 'motion2', label: 'motion2（モーション2）' },
  { key: 'motion3', label: 'motion3（モーション3）' },
  { key: 'motion4', label: 'motion4（モーション4）' },
  { key: 'motion5', label: 'motion5（モーション5）' },
  { key: 'motion6', label: 'motion6（モーション6）' },
] as const

/** 感情タグ定義（管理画面と同一順序） */
const EMOTION_TAGS = [
  { key: 'neutral', label: 'neutral（通常）' },
  { key: 'happy', label: 'happy（喜び）' },
  { key: 'thinking', label: 'thinking（考え中）' },
  { key: 'surprised', label: 'surprised（驚き）' },
  { key: 'sad', label: 'sad（悲しみ）' },
  { key: 'embarrassed', label: 'embarrassed（照れ）' },
  { key: 'troubled', label: 'troubled（困惑）' },
  { key: 'angry', label: 'angry（怒り）' },
  { key: 'error', label: 'error（エラー）' },
] as const

/** デフォルトのモーション定義（mao_pro用フォールバック） */
const DEFAULT_MOTIONS = [
  { label: 'アイドル', group: 'Idle', index: 0 },
  { label: 'モーション1', group: '', index: 0 },
  { label: 'モーション2', group: '', index: 1 },
  { label: 'モーション3', group: '', index: 2 },
  { label: 'スペシャル1', group: '', index: 3 },
  { label: 'スペシャル2', group: '', index: 4 },
  { label: 'スペシャル3', group: '', index: 5 },
]

/** デフォルトの表情定義（mao_pro用フォールバック） */
const DEFAULT_EXPRESSIONS = [
  { label: '通常(neutral)', name: 'exp_01' },
  { label: '嬉しい(happy)', name: 'exp_02' },
  { label: '考え中(thinking)', name: 'exp_03' },
  { label: '驚き(surprised)', name: 'exp_04' },
  { label: '悲しい(sad)', name: 'exp_05' },
  { label: '照れ(embarrassed)', name: 'exp_06' },
  { label: '困る(troubled)', name: 'exp_07' },
  { label: '怒り(angry)', name: 'exp_08' },
]

/**
 * モーション/表情コントロールパネル
 *
 * activeModelMeta にマッピング設定がある場合はそちらを使用し、
 * ない場合はデフォルト（mao_pro）にフォールバック。
 */
export function MotionPanel({ onPlayMotion, onPlayExpression }: MotionPanelProps) {
  const meta = useAppStore((s) => s.activeModelMeta)

  // マッピングから設定済みのエントリのみ、管理画面と同じ順序でボタンリストを生成
  // meta がない場合はデフォルト、meta がある場合は設定済みのみ（0件なら非表示）
  const motionMap = meta?.motionMapping ?? {}
  const motions = meta
    ? MOTION_TAGS
        .filter((t) => motionMap[t.key] != null)
        .map((t) => ({
          label: t.label,
          group: motionMap[t.key].group,
          index: motionMap[t.key].index,
        }))
    : DEFAULT_MOTIONS

  const emotionMap = meta?.emotionMapping ?? {}
  const expressions = meta
    ? EMOTION_TAGS
        .filter((t) => emotionMap[t.key] && emotionMap[t.key] !== '')
        .map((t) => ({
          label: t.label,
          name: emotionMap[t.key],
        }))
    : DEFAULT_EXPRESSIONS

  const handleMotionClick = useCallback((group: string, index: number) => {
    onPlayMotion(group, index)
  }, [onPlayMotion])

  const handleExpressionClick = useCallback((name: string) => {
    onPlayExpression(name)
  }, [onPlayExpression])

  // モーションも表情も0件なら何も表示しない
  if (motions.length === 0 && expressions.length === 0) {
    return null
  }

  return (
    <div className="p-1 sm:p-2 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-lg shadow-lg">
      {/* モーションボタン */}
      {motions.length > 0 && (
        <div className={expressions.length > 0 ? 'mb-1 sm:mb-2' : ''}>
          <p className="text-[10px] sm:text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">モーション</p>
          <div className="flex flex-wrap gap-0.5 sm:gap-1">
            {motions.map((motion) => (
              <button
                key={`${motion.group}-${motion.index}`}
                onClick={() => handleMotionClick(motion.group, motion.index)}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
              >
                {motion.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 表情ボタン */}
      {expressions.length > 0 && (
        <div>
          <p className="text-[10px] sm:text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">表情</p>
          <div className="flex flex-wrap gap-0.5 sm:gap-1">
            {expressions.map((exp) => (
              <button
                key={exp.name}
                onClick={() => handleExpressionClick(exp.name)}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs bg-purple-500 hover:bg-purple-600 text-white rounded transition-colors"
              >
                {exp.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
