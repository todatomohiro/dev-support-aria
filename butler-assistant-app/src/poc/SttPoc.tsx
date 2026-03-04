import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router'

/** Web Speech API の型定義（ブラウザ標準 API） */
interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList
  resultIndex: number
}

interface SpeechRecognitionErrorEvent {
  error: string
  message: string
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance
}

/** webkit プレフィックス対応で SpeechRecognition を取得 */
function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as SpeechRecognitionConstructor | null
}

type Status = 'idle' | 'listening' | 'error' | 'unsupported'

/** 認識履歴の1エントリ */
interface TranscriptEntry {
  text: string
  confidence: number
  timestamp: Date
}

/** チャットシミュレーションのメッセージ */
interface SimMessage {
  role: 'user' | 'assistant'
  text: string
}

/** エラーコードに対応する日本語メッセージ */
function getErrorMessage(errorCode: string): string {
  switch (errorCode) {
    case 'not-allowed':
      return 'マイクの使用が許可されていません。ブラウザの設定を確認してください。'
    case 'no-speech':
      return '音声が検出されませんでした。もう一度お試しください。'
    case 'network':
      return 'ネットワークエラーが発生しました。接続を確認してください。'
    case 'aborted':
      return '音声認識が中断されました。'
    case 'audio-capture':
      return 'マイクが見つかりません。マイクが接続されているか確認してください。'
    case 'service-not-allowed':
      return '音声認識サービスが許可されていません。'
    default:
      return `音声認識エラー: ${errorCode}`
  }
}

/**
 * Speech-to-Text PoC ページ
 *
 * Web Speech API を使った音声入力の検証ページ。
 * ブラウザ標準 API のみを使用し、外部依存なし。
 */
export function SttPoc() {
  const navigate = useNavigate()
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  /** 連続モードの最新値を onend コールバックから参照するための ref */
  const isContinuousRef = useRef(false)
  /** コンポーネントがマウント中かどうか */
  const isMountedRef = useRef(true)

  const [status, setStatus] = useState<Status>(() =>
    getSpeechRecognition() ? 'idle' : 'unsupported'
  )
  const [interimText, setInterimText] = useState('')
  const [finalText, setFinalText] = useState('')
  const [transcriptHistory, setTranscriptHistory] = useState<TranscriptEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isContinuous, setIsContinuous] = useState(false)
  const [simMessages, setSimMessages] = useState<SimMessage[]>([])

  // isContinuous の変更を ref に同期
  useEffect(() => {
    isContinuousRef.current = isContinuous
  }, [isContinuous])

  // アンマウント時に認識を確実に停止
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      recognitionRef.current?.abort()
      recognitionRef.current = null
    }
  }, [])

  /** 音声認識の開始 */
  const startListening = useCallback(() => {
    const SpeechRecognition = getSpeechRecognition()
    if (!SpeechRecognition) return

    // 既存のインスタンスがあれば停止
    if (recognitionRef.current) {
      recognitionRef.current.abort()
      recognitionRef.current = null
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'ja-JP'
    recognition.continuous = isContinuousRef.current
    recognition.interimResults = true
    recognitionRef.current = recognition

    recognition.onstart = () => {
      if (!isMountedRef.current) return
      setStatus('listening')
      setError(null)
      setInterimText('')
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (!isMountedRef.current) return

      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          const transcript = result[0].transcript
          const confidence = result[0].confidence

          setFinalText((prev) => prev + transcript)
          setTranscriptHistory((prev) => [
            { text: transcript, confidence, timestamp: new Date() },
            ...prev,
          ])
          setInterimText('')
        } else {
          interim += result[0].transcript
        }
      }
      if (interim) {
        setInterimText(interim)
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (!isMountedRef.current) return
      // no-speech は連続モードでは頻繁に起こるので error 状態にしない
      if (event.error === 'no-speech') {
        setError(getErrorMessage(event.error))
        return
      }
      if (event.error === 'aborted') return
      setStatus('error')
      setError(getErrorMessage(event.error))
    }

    recognition.onend = () => {
      if (!isMountedRef.current) return
      // 連続モードかつ listening 中なら自動再スタート
      if (isContinuousRef.current && recognitionRef.current === recognition) {
        try {
          recognition.start()
          return
        } catch {
          // 再スタート失敗時はそのまま idle へ
        }
      }
      setStatus('idle')
      setInterimText('')
      recognitionRef.current = null
    }

    try {
      recognition.start()
    } catch {
      setStatus('error')
      setError('音声認識の開始に失敗しました。')
    }
  }, [])

  /** 音声認識の停止 */
  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      // 連続モード ref を先にオフにして onend での再スタートを防ぐ
      isContinuousRef.current = false
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    setStatus('idle')
    setInterimText('')
  }, [])

  /** マイクボタンのトグル */
  const toggleListening = useCallback(() => {
    if (status === 'listening') {
      stopListening()
    } else {
      startListening()
    }
  }, [status, startListening, stopListening])

  /** メッセージとして送信（チャットシミュレーション） */
  const handleSend = useCallback(() => {
    const text = finalText.trim()
    if (!text) return

    setSimMessages((prev) => [
      ...prev,
      { role: 'user', text },
      { role: 'assistant', text: `「${text}」を受け取りました。（シミュレーション応答）` },
    ])
    setFinalText('')
  }, [finalText])

  /** 確定テキストをクリア */
  const handleClear = useCallback(() => {
    setFinalText('')
    setInterimText('')
  }, [])

  /** 履歴をクリア */
  const handleClearHistory = useCallback(() => {
    setTranscriptHistory([])
  }, [])

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
            Speech-to-Text PoC
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

          {/* 非対応ブラウザ警告 */}
          {status === 'unsupported' && (
            <section className="bg-amber-50 dark:bg-amber-900/30 rounded-lg p-4 border border-amber-200 dark:border-amber-700">
              <h3 className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-2">
                非対応ブラウザです
              </h3>
              <p className="text-sm text-amber-700 dark:text-amber-300">
                お使いのブラウザは Web Speech API（音声認識）に対応していません。
                Chrome, Edge, Safari での利用を推奨します。
              </p>
            </section>
          )}

          {/* 音声認識パネル */}
          {status !== 'unsupported' && (
            <section className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700 space-y-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">音声認識</h3>

              {/* ステータス表示 */}
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    status === 'listening'
                      ? 'bg-red-500 animate-pulse'
                      : status === 'error'
                        ? 'bg-amber-500'
                        : 'bg-gray-400'
                  }`}
                />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {status === 'listening' && '認識中...'}
                  {status === 'idle' && '待機中'}
                  {status === 'error' && 'エラー'}
                </span>
              </div>

              {/* 連続認識モード */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isContinuous}
                  onChange={(e) => setIsContinuous(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  disabled={status === 'listening'}
                />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  連続認識モード（自動で再スタート）
                </span>
              </label>

              {/* マイクボタン */}
              <div className="flex justify-center py-2">
                <button
                  onClick={toggleListening}
                  className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${
                    status === 'listening'
                      ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/30 animate-pulse'
                      : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/30'
                  }`}
                  title={status === 'listening' ? '停止' : '音声認識を開始'}
                >
                  {status === 'listening' ? (
                    /* 停止アイコン */
                    <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
                      <rect x="6" y="6" width="12" height="12" rx="1" />
                    </svg>
                  ) : (
                    /* マイクアイコン */
                    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  )}
                </button>
              </div>

              {/* 中間結果（リアルタイム） */}
              {interimText && (
                <p className="text-sm text-gray-400 italic px-1">
                  {interimText}
                </p>
              )}

              {/* 確定テキスト */}
              <div>
                <label htmlFor="final-text" className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                  認識テキスト（編集可能）
                </label>
                <textarea
                  id="final-text"
                  value={finalText}
                  onChange={(e) => setFinalText(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm resize-y focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="音声認識の結果がここに表示されます..."
                />
              </div>

              {/* アクションボタン */}
              <div className="flex gap-2">
                <button
                  onClick={handleSend}
                  disabled={!finalText.trim()}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors text-sm"
                >
                  メッセージとして送信
                </button>
                <button
                  onClick={handleClear}
                  disabled={!finalText && !interimText}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-200 font-medium rounded-lg transition-colors text-sm"
                >
                  クリア
                </button>
              </div>
            </section>
          )}

          {/* エラー表示 */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 rounded-lg p-3 border border-red-200 dark:border-red-700">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          {/* チャットシミュレーション */}
          {simMessages.length > 0 && (
            <section className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700 space-y-3">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">チャットシミュレーション</h3>
              <div className="space-y-2">
                {simMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                        msg.role === 'user'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 認識履歴 */}
          {transcriptHistory.length > 0 && (
            <section className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">認識履歴</h3>
                <button
                  onClick={handleClearHistory}
                  className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  クリア
                </button>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {transcriptHistory.map((entry, i) => (
                  <div
                    key={i}
                    className="flex items-baseline justify-between gap-2 text-sm py-1 border-b border-gray-100 dark:border-gray-700 last:border-0"
                  >
                    <span className="text-gray-900 dark:text-gray-100 flex-1 min-w-0 truncate">
                      {entry.text}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                      {Math.round(entry.confidence * 100)}%
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                      {entry.timestamp.toLocaleTimeString('ja-JP')}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 対応ブラウザ情報 */}
          <section className="bg-gray-100 dark:bg-gray-800/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">対応ブラウザ</h3>
            <p className="text-xs text-gray-500 dark:text-gray-500">
              Web Speech API は Chrome, Edge, Safari で動作します。
              Firefox は現在未対応です。iOS Safari では HTTPS 環境が必要です。
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
