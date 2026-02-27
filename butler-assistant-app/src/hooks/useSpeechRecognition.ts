import { useState, useCallback, useRef, useEffect } from 'react'

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

interface UseSpeechRecognitionOptions {
  lang?: string
  continuous?: boolean
  onResult?: (text: string) => void
}

interface UseSpeechRecognitionReturn {
  status: Status
  interimText: string
  error: string | null
  toggleListening: () => void
  isSupported: boolean
}

/**
 * Web Speech API を利用した音声認識カスタムフック
 *
 * ブラウザ標準の SpeechRecognition API をラップし、
 * 音声入力の開始・停止・中間結果・確定テキストのコールバックを提供する。
 */
export function useSpeechRecognition(options?: UseSpeechRecognitionOptions): UseSpeechRecognitionReturn {
  const lang = options?.lang ?? 'ja-JP'
  const continuous = options?.continuous ?? false
  const onResultRef = useRef(options?.onResult)

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const isContinuousRef = useRef(continuous)
  const isMountedRef = useRef(true)

  const [status, setStatus] = useState<Status>(() =>
    getSpeechRecognition() ? 'idle' : 'unsupported'
  )
  const [interimText, setInterimText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const isSupported = status !== 'unsupported'

  // コールバック・オプションの ref 同期
  useEffect(() => {
    onResultRef.current = options?.onResult
  }, [options?.onResult])

  useEffect(() => {
    isContinuousRef.current = continuous
  }, [continuous])

  // アンマウント時に認識を停止
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

    if (recognitionRef.current) {
      recognitionRef.current.abort()
      recognitionRef.current = null
    }

    const recognition = new SpeechRecognition()
    recognition.lang = lang
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
          onResultRef.current?.(transcript)
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
  }, [lang])

  /** 音声認識の停止 */
  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      isContinuousRef.current = false
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    setStatus('idle')
    setInterimText('')
  }, [])

  /** 音声認識の開始・停止をトグル */
  const toggleListening = useCallback(() => {
    if (status === 'listening') {
      stopListening()
    } else {
      startListening()
    }
  }, [status, startListening, stopListening])

  return { status, interimText, error, toggleListening, isSupported }
}
