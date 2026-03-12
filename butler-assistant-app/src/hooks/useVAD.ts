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
  /** 監視中か */
  isMonitoring: boolean
  /** 共有用 AnalyserNode（監視中のみ有効） */
  analyserNode: AnalyserNode | null
  /** 共有用 AudioContext のサンプルレート（監視中のみ有効） */
  sampleRate: number
}

/** 初期音量しきい値（キャリブレーション前のフォールバック） */
const DEFAULT_VOLUME_THRESHOLD = 15
/** speaking→silent 切り替えに必要な無音持続時間（ms） */
const HYSTERESIS_MS = 700
/** キャリブレーション期間（ms） — 開始直後の環境ノイズを測定 */
const CALIBRATION_DURATION_MS = 1500
/** キャリブレーション時のしきい値マージン倍率 */
const CALIBRATION_MARGIN = 2.0
/** キャリブレーション後の最小しきい値 */
const MIN_THRESHOLD = 5
/** キャリブレーション後の最大しきい値 */
const MAX_THRESHOLD = 40

/**
 * 音声帯域（100Hz〜8000Hz）の周波数ビンインデックスを算出
 */
function getVoiceBandRange(sampleRate: number, fftSize: number): { start: number; end: number } {
  const binWidth = sampleRate / fftSize
  const start = Math.max(0, Math.floor(100 / binWidth))
  const end = Math.min(fftSize / 2, Math.ceil(8000 / binWidth))
  return { start, end }
}

/**
 * Web Audio API を利用した VAD（Voice Activity Detection）フック
 *
 * マイク音量をリアルタイム監視し、発話中/無音状態を検出する。
 * - 音声帯域（100Hz〜8000Hz）のみフィルタリング
 * - 起動直後のキャリブレーションで環境ノイズに適応
 * - ヒステリシス（700ms）で自然な息継ぎに対応
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
  const isMountedRef = useRef(true)

  /** 適応的しきい値 */
  const thresholdRef = useRef(DEFAULT_VOLUME_THRESHOLD)
  /** キャリブレーション中か */
  const isCalibrating = useRef(false)
  /** キャリブレーション開始時刻 */
  const calibrationStartRef = useRef(0)
  /** キャリブレーション中のノイズサンプル */
  const calibrationSamplesRef = useRef<number[]>([])
  /** 音声帯域ビン範囲 */
  const voiceBandRef = useRef({ start: 0, end: 128 })

  const isSupported = typeof window !== 'undefined' &&
    !!(window.AudioContext || (window as unknown as Record<string, unknown>).webkitAudioContext) &&
    !!navigator.mediaDevices?.getUserMedia

  /** 音声帯域の平均音量を計算 */
  const computeVoiceBandAverage = useCallback((data: Uint8Array): number => {
    const { start, end } = voiceBandRef.current
    if (end <= start) return 0

    let sum = 0
    for (let i = start; i < end && i < data.length; i++) {
      sum += data[i]
    }
    return sum / (end - start)
  }, [])

  /** キャリブレーション完了処理 */
  const finishCalibration = useCallback(() => {
    const samples = calibrationSamplesRef.current
    if (samples.length === 0) {
      thresholdRef.current = DEFAULT_VOLUME_THRESHOLD
    } else {
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length
      const threshold = Math.round(avg * CALIBRATION_MARGIN)
      thresholdRef.current = Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, threshold))
    }
    isCalibrating.current = false
    calibrationSamplesRef.current = []
    console.log(`[VAD] キャリブレーション完了: しきい値=${thresholdRef.current}`)
  }, [])

  /** 音量解析ループ */
  const analyseLoop = useCallback((timestamp: number) => {
    if (!isMountedRef.current) return
    const analyser = analyserRef.current
    if (!analyser) return

    const data = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(data)

    // 音声帯域のみの平均音量を計算
    const average = computeVoiceBandAverage(data)

    // キャリブレーション中: ノイズレベルを収集
    if (isCalibrating.current) {
      calibrationSamplesRef.current.push(average)
      if (timestamp - calibrationStartRef.current >= CALIBRATION_DURATION_MS) {
        finishCalibration()
      }
      rafIdRef.current = requestAnimationFrame(analyseLoop)
      return
    }

    const speaking = average > thresholdRef.current

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
        silenceStartRef.current = timestamp
      }
      const silenceMs = timestamp - silenceStartRef.current
      setSilenceDurationMs(silenceMs)

      // ヒステリシス: 700ms 以上無音が続いたら silent に切り替え
      if (isSpeakingRef.current && silenceMs >= HYSTERESIS_MS) {
        isSpeakingRef.current = false
        setIsSpeaking(false)
      }
    }

    rafIdRef.current = requestAnimationFrame(analyseLoop)
  }, [computeVoiceBandAverage, finishCalibration])

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
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.5
    source.connect(analyser)

    // 音声帯域ビン範囲を算出
    voiceBandRef.current = getVoiceBandRange(audioContext.sampleRate, analyser.fftSize)
    console.log(`[VAD] 音声帯域ビン: ${voiceBandRef.current.start}〜${voiceBandRef.current.end} (sampleRate=${audioContext.sampleRate})`)

    audioContextRef.current = audioContext
    analyserRef.current = analyser
    streamRef.current = stream

    // 初期状態リセット + キャリブレーション開始
    isSpeakingRef.current = false
    silenceStartRef.current = null
    setIsSpeaking(false)
    setSilenceDurationMs(0)

    isCalibrating.current = true
    calibrationStartRef.current = performance.now()
    calibrationSamplesRef.current = []

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
    isCalibrating.current = false
    calibrationSamplesRef.current = []
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

  return {
    isSpeaking,
    silenceDurationMs,
    startMonitoring,
    stopMonitoring,
    isSupported,
    isMonitoring: !!audioContextRef.current,
    analyserNode: analyserRef.current,
    sampleRate: audioContextRef.current?.sampleRate ?? 48000,
  }
}
