import { useLocation, useNavigate } from 'react-router'

interface VoiceTurn {
  role: 'user' | 'assistant'
  text: string
  timestamp: number
  emotion?: string
}

/**
 * 音声会話終了サマリー画面
 *
 * 会話の要約・ターン数・所要時間を表示。
 * トピック保存 or マイAi-Ba(α) に戻る。
 */
export function VoiceChatSummary() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as { turns?: VoiceTurn[]; elapsedSeconds?: number } | null

  const turns = state?.turns ?? []
  const elapsedSeconds = state?.elapsedSeconds ?? 0
  const userTurns = turns.filter((t) => t.role === 'user').length

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}分${s.toString().padStart(2, '0')}秒`
  }

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-gray-900 overflow-y-auto">
      {/* ヘッダー */}
      <div className="text-center pt-8 pb-4 px-6">
        <div className="text-5xl mb-3">🎙️</div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">会話が終了しました</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          通話時間: {formatDuration(elapsedSeconds)} ・ {userTurns}ターン
        </p>
      </div>

      {/* 会話ログ */}
      <div className="px-5 pb-6">
        {turns.length > 0 ? (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-2xl p-4 mb-4">
            <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-3 flex items-center gap-1.5">
              💬 会話ログ
            </h3>
            <div className="space-y-3 max-h-[300px] overflow-y-auto">
              {turns.map((turn, i) => (
                <div key={i} className={turn.role === 'user' ? 'text-right' : ''}>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 font-semibold">
                    {turn.role === 'user' ? 'あなた' : 'Ai-Ba'}
                  </span>
                  <p className={`text-sm leading-relaxed mt-0.5 ${
                    turn.role === 'user'
                      ? 'text-blue-700 dark:text-blue-300'
                      : 'text-gray-700 dark:text-gray-200'
                  }`}>
                    {turn.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-2xl p-6 mb-4 text-center">
            <p className="text-sm text-gray-400">会話はありませんでした</p>
          </div>
        )}

        {/* 情報カード */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-2xl p-4 mb-4">
          <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-2 flex items-center gap-1.5">
            🧠 記憶
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
            会話内容はメインセッションに保存済みです。永久記憶への反映はセッション終了時に自動で行われます。
          </p>
        </div>
      </div>

      {/* アクションボタン */}
      <div className="px-5 pb-8 mt-auto flex flex-col gap-3">
        <button
          onClick={() => navigate('/aiba-alpha')}
          className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition-colors"
        >
          もう一度話す
        </button>
        <button
          onClick={() => navigate('/')}
          className="w-full py-3.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-semibold text-sm transition-colors"
        >
          チャットに戻る
        </button>
      </div>
    </div>
  )
}
