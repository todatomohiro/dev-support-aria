import { useState, useRef, useCallback, useEffect } from 'react'

interface UseVADReturn {
  /** 現在発話中か */
  isSpeaking: boolean
  /** 無音継続時間（ms） */
  silenceDurationMs: number
  /** VAD 監視を開始 */
  startMonitoring: () => Promise<void>
  /** VAD 監視を停止 */
  stopMonitoring: () => void
  /** VAD が利用可能か */
  isSupported: boolean
}

/** 音量しきい値（0-255、AnalyserNode の getByteFrequencyData 基準） */
const VOLUME_THRESHOLD = 15
/** speaking→silent 切り替えに必要な無音持続時間（ms） */
const HYSTERESIS_MS = 300

/**
 * Web Audio API を利用した VAD（Voice Activity Detection）フック
 *
 * マイク音量をリアルタイム監視し、発話中/無音状態を検出する。
 * ヒステリシス（チャタリング防止）付き。
 */
export function useVAD(): UseVADReturn {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [silenceDurationMs, setSilenceDurationMs] = useState(0)

  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafIdRef = useRef<number | null>(null)

  const isSpeakingRef = useRef(false)
  const silenceStartRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef<number>(0)
  const isMountedRef = useRef(true)

  const isSupported = typeof window !== 'undefined' &&
    !!(window.AudioContext || (window as unknown as Record<string, unknown>).webkitAudioContext) &&
    !!navigator.mediaDevices?.getUserMedia

  /** 音量解析ループ */
  const analyseLoop = useCallback((timestamp: number) => {
    if (!isMountedRef.current) return
    const analyser = analyserRef.current
    if (!analyser) return

    const data = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(data)

    // 平均音量を計算
    let sum = 0
    for (let i = 0; i < data.length; i++) {
      sum += data[i]
    }
    const average = sum / data.length

    const now = timestamp
    const speaking = average > VOLUME_THRESHOLD

    if (speaking) {
      // 発話検出 → 即座に speaking に切り替え
      silenceStartRef.current = null
      if (!isSpeakingRef.current) {
        isSpeakingRef.current = true
        setIsSpeaking(true)
      }
      setSilenceDurationMs(0)
    } else {
      // 無音検出
      if (silenceStartRef.current === null) {
        silenceStartRef.current = now
      }
      const silenceMs = now - silenceStartRef.current
      setSilenceDurationMs(silenceMs)

      // ヒステリシス: 300ms 以上無音が続いたら silent に切り替え
      if (isSpeakingRef.current && silenceMs >= HYSTERESIS_MS) {
        isSpeakingRef.current = false
        setIsSpeaking(false)
      }
    }

    lastFrameTimeRef.current = now
    rafIdRef.current = requestAnimationFrame(analyseLoop)
  }, [])

  /** VAD 監視を開始 */
  const startMonitoring = useCallback(async () => {
    // 既に監視中なら何もしない
    if (audioContextRef.current) return

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    if (!isMountedRef.current) {
      stream.getTracks().forEach(t => t.stop())
      return
    }

    const AudioContextClass = window.AudioContext ||
      (window as unknown as Record<string, unknown>).webkitAudioContext as typeof AudioContext
    const audioContext = new AudioContextClass()
    const source = audioContext.createMediaStreamSource(stream)
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.5
    source.connect(analyser)

    audioContextRef.current = audioContext
    analyserRef.current = analyser
    streamRef.current = stream

    // 初期状態リセット
    isSpeakingRef.current = false
    silenceStartRef.current = null
    setIsSpeaking(false)
    setSilenceDurationMs(0)

    rafIdRef.current = requestAnimationFrame(analyseLoop)
  }, [analyseLoop])

  /** VAD 監視を停止 */
  const stopMonitoring = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    analyserRef.current = null

    isSpeakingRef.current = false
    silenceStartRef.current = null
    setIsSpeaking(false)
    setSilenceDurationMs(0)
  }, [])

  // アンマウント時にクリーンアップ
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      stopMonitoring()
    }
  }, [stopMonitoring])

  return { isSpeaking, silenceDurationMs, startMonitoring, stopMonitoring, isSupported }
}
