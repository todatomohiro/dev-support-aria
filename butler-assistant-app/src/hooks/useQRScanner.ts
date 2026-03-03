import { useState, useRef, useCallback, useEffect } from 'react'
import jsQR from 'jsqr'
import { useCamera, type CameraStatus } from './useCamera'

/** QRスキャナーの状態 */
export type QRScannerStatus = 'inactive' | 'scanning' | 'found' | 'error'

/** useQRScanner の戻り値 */
export interface UseQRScannerResult {
  /** video 要素にバインドする ref */
  videoRef: React.RefObject<HTMLVideoElement | null>
  /** スキャナーの状態 */
  status: QRScannerStatus
  /** カメラの状態 */
  cameraStatus: CameraStatus
  /** エラーメッセージ */
  error: string | null
  /** 検出されたQRデータ */
  data: string | null
  /** スキャン開始 */
  start: () => Promise<void>
  /** スキャン停止 */
  stop: () => void
  /** データをリセットして再スキャン */
  reset: () => void
}

/** スキャン間隔（ミリ秒） */
const SCAN_INTERVAL = 200 // ~5fps

/**
 * QRコードスキャナーフック
 *
 * useCamera をラップし、jsqr でフレームからQRコードをデコードする。
 */
export function useQRScanner(): UseQRScannerResult {
  const camera = useCamera()
  const [status, setStatus] = useState<QRScannerStatus>('inactive')
  const [data, setData] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /** フレームをスキャン */
  const scanFrame = useCallback(() => {
    const video = camera.videoRef.current
    if (!video || video.readyState < 2) return

    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas')
    }
    const canvas = canvasRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

    const code = jsQR(imageData.data, imageData.width, imageData.height)
    if (code?.data) {
      setData(code.data)
      setStatus('found')
      // 検出後はスキャン停止
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current)
        scanIntervalRef.current = null
      }
    }
  }, [camera.videoRef])

  /** スキャン開始 */
  const start = useCallback(async () => {
    setData(null)
    setError(null)
    setStatus('scanning')

    await camera.start()

    // カメラ起動後にスキャンインターバルを開始
    scanIntervalRef.current = setInterval(scanFrame, SCAN_INTERVAL)
  }, [camera, scanFrame])

  /** スキャン停止 */
  const stop = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current)
      scanIntervalRef.current = null
    }
    camera.stop()
    setStatus('inactive')
  }, [camera])

  /** リセットして再スキャン */
  const reset = useCallback(() => {
    setData(null)
    setStatus('scanning')
    scanIntervalRef.current = setInterval(scanFrame, SCAN_INTERVAL)
  }, [scanFrame])

  // カメラエラー時にスキャンインターバルを停止
  useEffect(() => {
    if (camera.status === 'error' && scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current)
      scanIntervalRef.current = null
    }
  }, [camera.status])

  // アンマウント時にクリーンアップ
  useEffect(() => {
    return () => {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current)
      }
    }
  }, [])

  // カメラエラーの場合はQRスキャナーもエラー状態
  const effectiveStatus: QRScannerStatus = camera.status === 'error' ? 'error' : status
  const effectiveError = camera.status === 'error' ? camera.error : error

  return {
    videoRef: camera.videoRef,
    status: effectiveStatus,
    cameraStatus: camera.status,
    error: effectiveError,
    data,
    start,
    stop,
    reset,
  }
}
