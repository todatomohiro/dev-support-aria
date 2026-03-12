import { useState, useRef, useCallback, useEffect } from 'react'

/** カメラの状態 */
export type CameraStatus = 'inactive' | 'starting' | 'active' | 'error'

/** カメラの向き */
export type FacingMode = 'user' | 'environment'

/** useCamera の戻り値 */
export interface UseCameraResult {
  /** video 要素にバインドする ref */
  videoRef: React.RefObject<HTMLVideoElement | null>
  /** カメラの状態 */
  status: CameraStatus
  /** エラーメッセージ */
  error: string | null
  /** 現在のフレームを JPEG base64 でキャプチャ（data: プレフィックスなし） */
  captureFrame: () => string | null
  /** カメラを開始 */
  start: (facing?: FacingMode) => Promise<void>
  /** カメラを停止 */
  stop: () => void
  /** 前面/背面を切り替える */
  toggleFacing: () => Promise<void>
  /** 現在のカメラの向き */
  facingMode: FacingMode
  /** 複数カメラが利用可能か */
  hasMultipleCameras: boolean
}

/** キャプチャ画像の最大幅（トークンコスト抑制） */
const MAX_CAPTURE_WIDTH = 512

/**
 * カメラ制御カスタムフック
 *
 * getUserMedia でカメラストリームを取得し、フレームキャプチャ機能を提供する。
 */
export function useCamera(): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [status, setStatus] = useState<CameraStatus>('inactive')
  const [error, setError] = useState<string | null>(null)
  const [facingMode, setFacingMode] = useState<FacingMode>('environment')
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false)
  const facingModeRef = useRef<FacingMode>('environment')

  /** カメラストリームを停止 */
  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setStatus('inactive')
    setError(null)
  }, [])

  /** カメラストリームを開始 */
  const start = useCallback(async (facing?: FacingMode) => {
    // ブラウザ対応チェック
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('このブラウザはカメラに対応していません')
      setStatus('error')
      return
    }

    const targetFacing = facing ?? facingModeRef.current
    setStatus('starting')
    setError(null)

    // 既存ストリームがあれば停止（Strict Mode 二重マウント対策）
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: targetFacing, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })

      streamRef.current = stream
      facingModeRef.current = targetFacing
      setFacingMode(targetFacing)

      // 複数カメラの検出
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const videoDevices = devices.filter((d) => d.kind === 'videoinput')
        setHasMultipleCameras(videoDevices.length > 1)
      } catch {
        // enumerateDevices 未対応でも続行
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        // iOS WKWebView では autoPlay だけでは再生されないため明示的に play()
        try {
          await videoRef.current.play()
        } catch (playErr) {
          if (playErr instanceof DOMException && playErr.name === 'AbortError') {
            // Strict Mode 二重マウント等で発生 — 次の start() に委ねる
            console.debug('[Camera] play() interrupted')
            return
          }
          throw playErr
        }

        // iOS WKWebView では play() 解決後も映像フレームが未準備の場合がある
        // readyState >= HAVE_CURRENT_DATA になるまで待機
        if (videoRef.current.readyState < 2) {
          await new Promise<void>((resolve) => {
            const video = videoRef.current
            if (!video) { resolve(); return }
            const onReady = () => { clearTimeout(timer); resolve() }
            const timer = setTimeout(() => {
              video.removeEventListener('loadeddata', onReady)
              resolve() // タイムアウトでもフォールバックで active にする
            }, 3000)
            video.addEventListener('loadeddata', onReady, { once: true })
          })
        }
      }

      setStatus('active')
    } catch (err) {
      const msg = err instanceof DOMException
        ? err.name === 'NotAllowedError'
          ? 'カメラの使用が許可されていません'
          : err.name === 'NotFoundError'
            ? 'カメラが見つかりません'
            : `カメラエラー: ${err.message}`
        : 'カメラの起動に失敗しました'

      setError(msg)
      setStatus('error')
    }
  }, [])

  /** 前面/背面カメラを切り替える */
  const toggleFacing = useCallback(async () => {
    const next: FacingMode = facingModeRef.current === 'user' ? 'environment' : 'user'
    await start(next)
  }, [start])

  /** 現在のフレームをキャプチャし JPEG base64 を返す */
  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current
    if (!video || video.readyState < 2) return null

    // canvas をオンデマンド生成
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas')
    }
    const canvas = canvasRef.current

    // アスペクト比維持でリサイズ
    const scale = Math.min(1, MAX_CAPTURE_WIDTH / video.videoWidth)
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)

    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    // data:image/jpeg;base64,... から プレフィックスを除去
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
    return dataUrl.replace(/^data:image\/jpeg;base64,/, '')
  }, [])

  // アンマウント時にクリーンアップ
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
      }
    }
  }, [])

  return { videoRef, status, error, captureFrame, start, stop, toggleFacing, facingMode, hasMultipleCameras }
}
