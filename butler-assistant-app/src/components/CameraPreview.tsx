import { useEffect, useImperativeHandle, forwardRef } from 'react'
import { useCamera } from '@/hooks/useCamera'

/** 親コンポーネントに公開するハンドル */
export interface CameraPreviewHandle {
  /** 現在のフレームを JPEG base64 でキャプチャ */
  captureFrame: () => string | null
}

interface CameraPreviewProps {
  /** カメラの有効/無効 */
  enabled: boolean
  /** 撮影完了コールバック（base64を返す） */
  onCapture?: (base64: string) => void
}

/**
 * カメラプレビューコンポーネント
 *
 * enabled が true のときにカメラを起動し、小さなプレビュー映像を表示する。
 * ref 経由で captureFrame() を親に公開する。
 */
export const CameraPreview = forwardRef<CameraPreviewHandle, CameraPreviewProps>(
  function CameraPreview({ enabled, onCapture }, ref) {
    const { videoRef, status, error, captureFrame, start, stop } = useCamera()

    // enabled の変化に応じてカメラを開始/停止
    useEffect(() => {
      if (enabled) {
        start()
      } else {
        stop()
      }
      return () => stop()
    }, [enabled, start, stop])

    // 親に captureFrame を公開
    useImperativeHandle(ref, () => ({ captureFrame }), [captureFrame])

    /** 撮影ボタンハンドラー */
    const handleCapture = () => {
      const base64 = captureFrame()
      if (base64 && onCapture) {
        onCapture(base64)
      }
    }

    if (!enabled) return null

    return (
      <div className="relative w-full max-w-[320px] aspect-[4/3] mx-auto mb-2 overflow-hidden rounded-lg" data-testid="camera-preview">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover bg-black"
        />
        {status === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
            <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 rounded-lg p-2">
            <p className="text-xs text-white text-center">{error}</p>
          </div>
        )}
        {/* 撮影ボタン */}
        {status === 'active' && (
          <button
            type="button"
            onClick={handleCapture}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-white border-2 border-gray-300 shadow-md flex items-center justify-center hover:bg-gray-100 active:scale-95 transition-all"
            title="撮影"
            data-testid="camera-capture-button"
          >
            <div className="w-7 h-7 rounded-full bg-red-500" />
          </button>
        )}
      </div>
    )
  }
)
