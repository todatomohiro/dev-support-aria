import { useNavigate } from 'react-router'

/** PoC メニュー項目 */
interface PocItem {
  path: string
  title: string
  description: string
  icon: string
}

const POC_ITEMS: readonly PocItem[] = [
  {
    path: '/poc/aivis',
    title: 'Aivis TTS',
    description: 'Aivis Cloud API 音声合成テスト',
    icon: '🗣️',
  },
  {
    path: '/poc/polly',
    title: 'Polly PoC',
    description: 'Amazon Polly の音声合成を検証',
    icon: '🔊',
  },
  {
    path: '/poc/stt',
    title: 'STT PoC',
    description: 'Web Speech API の音声認識を検証',
    icon: '🎤',
  },
  {
    path: '/poc/gps',
    title: 'GPS PoC',
    description: 'GPS 位置情報の精度をマップで確認',
    icon: '📍',
  },
  {
    path: '/poc/sentiment',
    title: 'テキスト感情分析 PoC',
    description: 'テキストからリアルタイム感情分析を検証',
    icon: '💭',
  },
  {
    path: '/poc/face-tracking',
    title: 'キャラクター操作テスト',
    description: 'カメラで顔を映してLive2Dキャラクターを操作',
    icon: '🎭',
  },
]

/**
 * PoC 一覧ページ
 *
 * 各 PoC ページへのナビゲーションを提供する。
 */
export function PocIndex() {
  const navigate = useNavigate()

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-2xl mx-auto w-full space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">PoC</h1>
          <button
            onClick={() => navigate('/')}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
          >
            ← 戻る
          </button>
        </div>

        <div className="grid gap-4">
          {POC_ITEMS.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="flex items-center gap-4 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-750 hover:border-gray-300 dark:hover:border-gray-600 transition-colors text-left"
            >
              <span className="text-2xl">{item.icon}</span>
              <div>
                <div className="font-medium text-gray-900 dark:text-white">{item.title}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">{item.description}</div>
              </div>
              <span className="ml-auto text-gray-400 dark:text-gray-500">→</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
