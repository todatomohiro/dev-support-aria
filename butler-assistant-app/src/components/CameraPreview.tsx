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
}

/**
 * カメラプレビューコンポーネント
 *
 * enabled が true のときにカメラを起動し、小さなプレビュー映像を表示する。
 * ref 経由で captureFrame() を親に公開する。
 */
export const CameraPreview = forwardRef<CameraPreviewHandle, CameraPreviewProps>(
  function CameraPreview({ enabled }, ref) {
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

    if (!enabled) return null

    return (
      <div className="relative w-[160px] aspect-square mx-auto mb-2 overflow-hidden rounded-lg" data-testid="camera-preview">
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
      </div>
    )
  }
)
