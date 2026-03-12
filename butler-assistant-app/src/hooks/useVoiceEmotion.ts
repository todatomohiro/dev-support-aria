import { useState, useRef, useEffect, useCallback } from 'react'

/** ユーザーの音声から推定される気分 */
export type UserMood = 'calm' | 'excited' | 'low' | 'tense' | 'neutral'

interface UseVoiceEmotionOptions {
  /** 共有 AnalyserNode（useVAD から取得） */
  analyserNode: AnalyserNode | null
  /** サンプルレート（useVAD から取得） */
  sampleRate: number
  /** ユーザーが発話中か（useVAD.isSpeaking） */
  isSpeaking: boolean
}

interface UseVoiceEmotionReturn {
  /** 推定されたユーザーの気分 */
  userMood: UserMood
}

/** 分析間隔（ms） */
const ANALYSIS_INTERVAL_MS = 200
/** スライディングウィンドウサイズ（2秒分 = 10サンプル） */
const WINDOW_SIZE = 10
/** 気分安定化に必要な連続一致数 */
const STABILITY_COUNT = 5
/** ピッチの基準値（Hz）— 日本語話者の平均的な基本周波数 */
const REFERENCE_PITCH_HZ = 200
/** 音量 RMS の閾値 — これ以下は「静か」とみなす */
const LOW_RMS_THRESHOLD = 0.08
/** 音量 RMS の閾値 — これ以上は「大きい」とみなす */
const HIGH_RMS_THRESHOLD = 0.2
/** エネルギー分散の閾値 — これ以上は「アニメーション的」とみなす */
const HIGH_VARIANCE_THRESHOLD = 0.005

/**
 * 自己相関法でピッチ（基本周波数）を推定する
 *
 * 時間領域データから自己相関を計算し、最初のピークのラグを基本周期とする。
 * 音声帯域（80Hz〜500Hz）の範囲でピークを探索。
 */
function estimatePitch(timeDomainData: Uint8Array, sampleRate: number): number | null {
  const size = timeDomainData.length
  // 80Hz〜500Hz に対応するラグ範囲
  const minLag = Math.floor(sampleRate / 500)
  const maxLag = Math.ceil(sampleRate / 80)

  if (maxLag >= size) return null

  // DC オフセット除去 + float 変換
  const data = new Float32Array(size)
  let sum = 0
  for (let i = 0; i < size; i++) sum += timeDomainData[i]
  const mean = sum / size
  for (let i = 0; i < size; i++) data[i] = (timeDomainData[i] - mean) / 128

  // エネルギーチェック（無音なら null）
  let energy = 0
  for (let i = 0; i < size; i++) energy += data[i] * data[i]
  if (energy / size < 0.001) return null

  // 正規化自己相関
  let bestLag = 0
  let bestCorr = 0

  for (let lag = minLag; lag <= maxLag && lag < size; lag++) {
    let corr = 0
    let norm1 = 0
    let norm2 = 0
    const len = size - lag
    for (let i = 0; i < len; i++) {
      corr += data[i] * data[i + lag]
      norm1 += data[i] * data[i]
      norm2 += data[i + lag] * data[i + lag]
    }
    const norm = Math.sqrt(norm1 * norm2)
    if (norm === 0) continue
    const r = corr / norm

    if (r > bestCorr) {
      bestCorr = r
      bestLag = lag
    }
  }

  // 相関が低すぎる場合は信頼性なし
  if (bestCorr < 0.3 || bestLag === 0) return null

  return sampleRate / bestLag
}

/**
 * RMS（二乗平均平方根）音量を計算する
 */
function computeRMS(timeDomainData: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < timeDomainData.length; i++) {
    const normalized = (timeDomainData[i] - 128) / 128
    sum += normalized * normalized
  }
  return Math.sqrt(sum / timeDomainData.length)
}

/**
 * 分散を計算する
 */
function computeVariance(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
}

/**
 * 音声特徴量から気分を推定する
 */
function inferMood(avgRMS: number, rmsVariance: number, avgPitch: number | null): UserMood {
  const isQuiet = avgRMS < LOW_RMS_THRESHOLD
  const isLoud = avgRMS > HIGH_RMS_THRESHOLD
  const isAnimated = rmsVariance > HIGH_VARIANCE_THRESHOLD
  const isPitchHigh = avgPitch !== null && avgPitch > REFERENCE_PITCH_HZ * 1.15
  const isPitchLow = avgPitch !== null && avgPitch < REFERENCE_PITCH_HZ * 0.85

  // 静かで低いピッチ → 落ち込み気味
  if (isQuiet && isPitchLow) return 'low'
  // 静かで安定 → 穏やか
  if (isQuiet && !isAnimated) return 'calm'
  // 大きくて高ピッチでアニメーション的 → 興奮
  if (isLoud && isAnimated && isPitchHigh) return 'excited'
  // 大きくてアニメーション的 → 興奮（ピッチ情報なしでも）
  if (isLoud && isAnimated) return 'excited'
  // 中〜大音量で高ピッチ → 緊張
  if (!isQuiet && isPitchHigh && !isAnimated) return 'tense'

  return 'neutral'
}

/**
 * ユーザーの音声から感情を推定するカスタムフック
 *
 * useVAD と AudioContext/AnalyserNode を共有し、追加のマイクアクセスなしで動作。
 * - 音量（RMS）: 声の大きさから活性度を判定
 * - ピッチ（自己相関法）: 基本周波数の高低から感情を推定
 * - エネルギー分散: 発話リズムのダイナミクスから興奮度を判定
 * - EMA + 安定化: 気分の急な変動を抑制（5連続一致で確定）
 */
export function useVoiceEmotion({ analyserNode, sampleRate, isSpeaking }: UseVoiceEmotionOptions): UseVoiceEmotionReturn {
  const [userMood, setUserMood] = useState<UserMood>('neutral')

  /** RMS 履歴（スライディングウィンドウ） */
  const rmsHistoryRef = useRef<number[]>([])
  /** ピッチ履歴（スライディングウィンドウ、null を除外） */
  const pitchHistoryRef = useRef<number[]>([])
  /** 候補気分のカウンタ（安定化用） */
  const candidateRef = useRef<{ mood: UserMood; count: number }>({ mood: 'neutral', count: 0 })
  /** 分析タイマー */
  const intervalIdRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /** 単一フレームの分析 */
  const analyseSingleFrame = useCallback(() => {
    if (!analyserNode) return

    const bufferLength = analyserNode.fftSize
    const timeDomainData = new Uint8Array(bufferLength)
    analyserNode.getByteTimeDomainData(timeDomainData)

    // RMS 計算
    const rms = computeRMS(timeDomainData)
    const rmsHistory = rmsHistoryRef.current
    rmsHistory.push(rms)
    if (rmsHistory.length > WINDOW_SIZE) rmsHistory.shift()

    // ピッチ推定
    const pitch = estimatePitch(timeDomainData, sampleRate)
    if (pitch !== null) {
      const pitchHistory = pitchHistoryRef.current
      pitchHistory.push(pitch)
      if (pitchHistory.length > WINDOW_SIZE) pitchHistory.shift()
    }

    // 特徴量集約
    const avgRMS = rmsHistory.reduce((a, b) => a + b, 0) / rmsHistory.length
    const rmsVariance = computeVariance(rmsHistory)
    const pitchHistory = pitchHistoryRef.current
    const avgPitch = pitchHistory.length > 0
      ? pitchHistory.reduce((a, b) => a + b, 0) / pitchHistory.length
      : null

    // 気分推定
    const inferred = inferMood(avgRMS, rmsVariance, avgPitch)

    // 安定化: 同じ気分が STABILITY_COUNT 連続したら確定
    const candidate = candidateRef.current
    if (inferred === candidate.mood) {
      candidate.count++
    } else {
      candidate.mood = inferred
      candidate.count = 1
    }

    if (candidate.count >= STABILITY_COUNT) {
      setUserMood(inferred)
    }
  }, [analyserNode, sampleRate])

  useEffect(() => {
    // 発話中のみ分析を実行
    if (!isSpeaking || !analyserNode) {
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current)
        intervalIdRef.current = null
      }
      return
    }

    // 履歴リセット
    rmsHistoryRef.current = []
    pitchHistoryRef.current = []
    candidateRef.current = { mood: 'neutral', count: 0 }

    intervalIdRef.current = setInterval(analyseSingleFrame, ANALYSIS_INTERVAL_MS)

    return () => {
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current)
        intervalIdRef.current = null
      }
    }
  }, [isSpeaking, analyserNode, analyseSingleFrame])

  return { userMood }
}
