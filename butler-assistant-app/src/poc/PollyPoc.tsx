import { useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router'
import { useAuthStore } from '@/auth'

/** 音声定義の型 */
interface Voice {
  id: string
  name: string
  engines: readonly string[]
}

/** 日本語音声の定義 */
const VOICES: readonly Voice[] = [
  { id: 'Kazuha', name: 'カズハ', engines: ['neural', 'long-form', 'generative'] },
  { id: 'Tomoko', name: 'トモコ', engines: ['neural', 'long-form', 'generative'] },
  { id: 'Takumi', name: 'タクミ', engines: ['standard'] },
  { id: 'Mizuki', name: 'ミズキ', engines: ['standard'] },
]

/**
 * Amazon Polly PoC ページ
 *
 * API Gateway + Lambda 経由で Polly の音声合成を検証する。
 */
export function PollyPoc() {
  const navigate = useNavigate()
  const authStatus = useAuthStore((s) => s.status)
  const accessToken = useAuthStore((s) => s.accessToken)

  const [selectedVoice, setSelectedVoice] = useState(VOICES[0])
  const [engine, setEngine] = useState<string>(VOICES[0].engines[0])
  const [text, setText] = useState('こんにちは、私はアマゾン ポリーです。')
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

  /** 音声選択ハンドラー */
  const handleVoiceChange = useCallback((voiceId: string) => {
    const voice = VOICES.find((v) => v.id === voiceId)
    if (voice) {
      setSelectedVoice(voice)
      setEngine(voice.engines[0])
    }
  }, [])

  /** 音声合成 & 再生 */
  const synthesize = async () => {
    if (!text.trim()) return

    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
    if (!apiBaseUrl) {
      setError('VITE_API_BASE_URL が未設定です')
      return
    }

    setIsSynthesizing(true)
    setError(null)
    revokeAudioUrl()

    try {
      const res = await fetch(`${apiBaseUrl}/tts/synthesize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          text,
          voiceId: selectedVoice.id,
          engine,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }

      const data = await res.json()

      // base64 → Blob → Object URL → 再生
      const binary = atob(data.audio)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      const blob = new Blob([bytes], { type: 'audio/mpeg' })
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

  const isAuthenticated = authStatus === 'authenticated'

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
            Amazon Polly PoC
          </h2>
        </div>
        <button
          onClick={() => navigate('/poc/stt')}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          STT PoC →
        </button>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* 未ログイン案内 */}
          {!isAuthenticated && (
            <section className="bg-amber-50 dark:bg-amber-900/30 rounded-lg p-4 border border-amber-200 dark:border-amber-700">
              <h3 className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-2">
                ログインが必要です
              </h3>
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Amazon Polly の音声合成を使うにはログインしてください。
                API Gateway の Cognito 認証を通じて Lambda を呼び出します。
              </p>
            </section>
          )}

          {/* 音声合成フォーム（認証時のみ） */}
          {isAuthenticated && (
            <section className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700 space-y-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">音声合成</h3>

              {/* 音声選択 */}
              <div>
                <label htmlFor="voice-select" className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                  音声
                </label>
                <select
                  id="voice-select"
                  value={selectedVoice.id}
                  onChange={(e) => handleVoiceChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {VOICES.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.name} ({voice.id})
                    </option>
                  ))}
                </select>
              </div>

              {/* エンジン選択 */}
              <div>
                <label htmlFor="engine-select" className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                  エンジン
                </label>
                <select
                  id="engine-select"
                  value={engine}
                  onChange={(e) => setEngine(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {selectedVoice.engines.map((eng) => (
                    <option key={eng} value={eng}>
                      {eng}
                    </option>
                  ))}
                </select>
              </div>

              {/* テキスト入力 */}
              <div>
                <label htmlFor="tts-text" className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                  読み上げテキスト
                </label>
                <textarea
                  id="tts-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm resize-y focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="読み上げたいテキストを入力..."
                />
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
          )}

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
