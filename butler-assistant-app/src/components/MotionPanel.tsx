import { useCallback } from 'react'

interface MotionPanelProps {
  onPlayMotion: (group: string, index: number) => void
  onPlayExpression: (name: string) => void
}

/**
 * モーション/表情コントロールパネル
 * mao_pro モデル用
 */
export function MotionPanel({ onPlayMotion, onPlayExpression }: MotionPanelProps) {
  const motions = [
    { label: 'アイドル', group: 'Idle', index: 0 },
    { label: 'モーション1', group: '', index: 0 },
    { label: 'モーション2', group: '', index: 1 },
    { label: 'モーション3', group: '', index: 2 },
    { label: 'スペシャル1', group: '', index: 3 },
    { label: 'スペシャル2', group: '', index: 4 },
    { label: 'スペシャル3', group: '', index: 5 },
  ]

  const expressions = [
    { label: '通常(neutral)', name: 'exp_01' },
    { label: '嬉しい(happy)', name: 'exp_02' },
    { label: '考え中(thinking)', name: 'exp_03' },
    { label: '驚き(surprised)', name: 'exp_04' },
    { label: '悲しい(sad)', name: 'exp_05' },
    { label: '照れ(embarrassed)', name: 'exp_06' },
    { label: '困る(troubled)', name: 'exp_07' },
    { label: '怒り(angry)', name: 'exp_08' },
  ]

  const handleMotionClick = useCallback((group: string, index: number) => {
    onPlayMotion(group, index)
  }, [onPlayMotion])

  const handleExpressionClick = useCallback((name: string) => {
    onPlayExpression(name)
  }, [onPlayExpression])

  return (
    <div className="p-1 sm:p-2 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-lg shadow-lg">
      {/* モーションボタン */}
      <div className="mb-1 sm:mb-2">
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

      {/* 表情ボタン */}
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
    </div>
  )
}
