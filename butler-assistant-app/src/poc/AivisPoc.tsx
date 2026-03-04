import { useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router'

/**
 * Aivis Cloud API TTS PoC ページ
 *
 * Aivis Cloud API を使った音声合成を検証する。
 * Cognito 認証不要（API キーで直接呼び出し）。
 */
export function AivisPoc() {
  const navigate = useNavigate()

  const [text, setText] = useState('こんにちは、私はアイビスです。')
  const [speakingRate, setSpeakingRate] = useState(1.0)
  const [pitch, setPitch] = useState(0.0)
  const [isSynthesizing, setIsSynthesizing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const audioUrlRef = useRef<string | null>(null)

  /** 前回の Object URL を解放 */
  const revokeAudioUrl = useCallback(() => {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
    }
  }, [])

  /** 音声合成 & 再生 */
  const synthesize = async () => {
    if (!text.trim()) return

    const apiKey = import.meta.env.VITE_AIVIS_API_KEY
    if (!apiKey) {
      setError('VITE_AIVIS_API_KEY が未設定です')
      return
    }

    const modelUuid = import.meta.env.VITE_AIVIS_MODEL_UUID
    if (!modelUuid) {
      setError('VITE_AIVIS_MODEL_UUID が未設定です')
      return
    }

    setIsSynthesizing(true)
    setError(null)
    revokeAudioUrl()

    try {
      const res = await fetch('https://api.aivis-project.com/v1/tts/synthesize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model_uuid: modelUuid,
          text,
          output_format: 'mp3',
          speaking_rate: speakingRate,
          pitch,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? data.message ?? `HTTP ${res.status}`)
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      audioUrlRef.current = url

      if (audioRef.current) {
        audioRef.current.src = url
        await audioRef.current.play()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '音声合成に失敗しました')
    } finally {
      setIsSynthesizing(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* ヘッダー */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/poc')}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
            title="PoC 一覧に戻る"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Aivis TTS PoC
          </h2>
        </div>
        <button
          onClick={() => navigate('/poc/polly')}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          Polly PoC →
        </button>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-2xl mx-auto space-y-6">

          <section className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700 space-y-4">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">音声合成</h3>

            {/* テキスト入力 */}
            <div>
              <label htmlFor="aivis-text" className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                読み上げテキスト
              </label>
              <textarea
                id="aivis-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm resize-y focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="読み上げたいテキストを入力..."
              />
            </div>

            {/* 話速スライダー */}
            <div>
              <label htmlFor="speaking-rate" className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                話速: {speakingRate.toFixed(1)}
              </label>
              <input
                id="speaking-rate"
                type="range"
                min={0.5}
                max={2.0}
                step={0.1}
                value={speakingRate}
                onChange={(e) => setSpeakingRate(Number(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-400">
                <span>0.5</span>
                <span>1.0</span>
                <span>2.0</span>
              </div>
            </div>

            {/* ピッチスライダー */}
            <div>
              <label htmlFor="pitch" className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                ピッチ: {pitch.toFixed(1)}
              </label>
              <input
                id="pitch"
                type="range"
                min={-1.0}
                max={1.0}
                step={0.1}
                value={pitch}
                onChange={(e) => setPitch(Number(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-400">
                <span>-1.0</span>
                <span>0.0</span>
                <span>1.0</span>
              </div>
            </div>

            {/* 合成 & 再生ボタン */}
            <button
              onClick={synthesize}
              disabled={isSynthesizing || !text.trim()}
              className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
            >
              {isSynthesizing ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  合成中...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  合成 &amp; 再生
                </>
              )}
            </button>

            {/* オーディオプレイヤー */}
            <audio ref={audioRef} controls className="w-full" />
          </section>

          {/* エラー表示 */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 rounded-lg p-3 border border-red-200 dark:border-red-700">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
