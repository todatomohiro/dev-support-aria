import { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react'
import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import { createVisibilityHandler } from '@/utils/performance'

// Cubism Core を window に登録（pixi-live2d-display が必要とする）
if (typeof window !== 'undefined') {
  ;(window as any).PIXI = PIXI
}

interface Live2DCanvasProps {
  modelPath: string
  currentMotion: string | null
  onMotionComplete?: () => void
  className?: string
}

export interface Live2DCanvasHandle {
  playMotion: (group: string, index: number) => void
  playExpression: (name: string) => void
}

/**
 * Live2D Canvas コンポーネント
 * pixi-live2d-display を使用した実装
 */
export const Live2DCanvas = forwardRef<Live2DCanvasHandle, Live2DCanvasProps>(function Live2DCanvas({
  modelPath,
  currentMotion,
  onMotionComplete,
  className = '',
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<PIXI.Application | null>(null)
  const modelRef = useRef<Live2DModel | null>(null)
  const originalSizeRef = useRef<{ width: number; height: number } | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showPlaceholder, setShowPlaceholder] = useState(true)

  // 外部からモーション/表情を再生するためのハンドル
  useImperativeHandle(ref, () => ({
    playMotion: (group: string, index: number) => {
      const model = modelRef.current
      if (model) {
        try {
          const motionManager = (model as any).internalModel?.motionManager
          if (motionManager) {
            motionManager.startMotion(group, index)
            console.log(`[Live2DCanvas] Playing motion: ${group}[${index}]`)
          }
        } catch (e) {
          console.warn('[Live2DCanvas] Motion playback error:', e)
        }
      }
    },
    playExpression: (name: string) => {
      const model = modelRef.current
      if (model) {
        try {
          // pixi-live2d-display の expression メソッドを使用
          ;(model as any).expression(name)
          console.log(`[Live2DCanvas] Playing expression: ${name}`)
        } catch (e) {
          console.warn('[Live2DCanvas] Expression playback error:', e)
        }
      }
    },
  }), [])

  // PixiJS アプリケーションの初期化
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let app: PIXI.Application | null = null
    let model: Live2DModel | null = null
    let isMounted = true

    const initApp = async () => {
      try {
        // PixiJS アプリケーションを作成
        app = new PIXI.Application({
          backgroundAlpha: 0,
          resizeTo: container,
          antialias: true,
        })

        // @ts-expect-error - PixiJS v7 の型との互換性
        container.appendChild(app.view)
        appRef.current = app

        // モデルパスが有効な場合のみ読み込み
        if (modelPath && modelPath !== 'default') {
          setIsLoading(true)
          setError(null)

          try {
            // Live2D モデルを読み込み
            model = await Live2DModel.from(modelPath, {
              autoInteract: false,
              autoUpdate: true,
            })

            if (!isMounted) {
              model.destroy()
              return
            }

            modelRef.current = model

            // 元のモデルサイズを保存（スケール計算用）
            originalSizeRef.current = {
              width: model.width,
              height: model.height,
            }

            // モデルのサイズと位置を調整（最大スケールを制限）
            const MAX_SCALE = 0.5  // 最大スケール
            const fitScale = Math.min(
              container.clientWidth / model.width,
              container.clientHeight / model.height
            )
            const scale = Math.min(fitScale, MAX_SCALE)

            model.scale.set(scale)
            model.x = container.clientWidth / 2
            model.y = container.clientHeight / 2
            model.anchor.set(0.5, 0.5)

            // ステージに追加
            app.stage.addChild(model)

            setShowPlaceholder(false)
            setIsLoading(false)

            console.log('[Live2DCanvas] Model loaded successfully:', modelPath)
          } catch (loadError) {
            console.error('[Live2DCanvas] Failed to load model:', loadError)
            setError('モデルの読み込みに失敗しました')
            setIsLoading(false)
            setShowPlaceholder(true)
          }
        } else {
          setIsLoading(false)
          setShowPlaceholder(true)
        }
      } catch (initError) {
        console.error('[Live2DCanvas] Failed to initialize:', initError)
        setError('初期化に失敗しました')
        setIsLoading(false)
      }
    }

    initApp()

    // クリーンアップ
    return () => {
      isMounted = false
      if (model) {
        model.destroy()
        modelRef.current = null
      }
      if (app) {
        app.destroy(true, { children: true, texture: true, baseTexture: true })
        appRef.current = null
      }
      originalSizeRef.current = null
    }
  }, [modelPath])

  // モーション再生
  useEffect(() => {
    const model = modelRef.current
    if (!model || !currentMotion) return

    // モーションマッピング
    const motionMap: Record<string, { group: string; index: number }> = {
      idle: { group: 'Idle', index: 0 },
      bow: { group: '', index: 0 },
      smile: { group: '', index: 1 },
      think: { group: '', index: 2 },
      nod: { group: '', index: 3 },
      wave: { group: '', index: 4 },
      happy: { group: '', index: 1 },
      sad: { group: '', index: 2 },
      nervous: { group: '', index: 3 },
      confused: { group: '', index: 2 },
    }

    const motion = motionMap[currentMotion] || { group: 'Idle', index: 0 }

    try {
      // モーションを再生
      const motionManager = model.internalModel?.motionManager
      if (motionManager) {
        motionManager.startMotion(motion.group, motion.index)?.then(() => {
          onMotionComplete?.()
        })
      }
    } catch (e) {
      console.warn('[Live2DCanvas] Motion playback error:', e)
      // モーション再生に失敗しても完了コールバックを呼ぶ
      setTimeout(() => onMotionComplete?.(), 1000)
    }
  }, [currentMotion, onMotionComplete])

  // リサイズ対応
  const handleResize = useCallback(() => {
    const container = containerRef.current
    const model = modelRef.current
    const originalSize = originalSizeRef.current
    if (!container || !model || !originalSize) return

    // 最大スケールを制限（元のサイズを基準に計算）
    const MAX_SCALE = 0.5
    const fitScale = Math.min(
      container.clientWidth / originalSize.width,
      container.clientHeight / originalSize.height
    )
    const scale = Math.min(fitScale, MAX_SCALE)

    model.scale.set(scale)
    model.x = container.clientWidth / 2
    model.y = container.clientHeight / 2
  }, [])

  // ResizeObserver でコンテナサイズの変更を監視
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const resizeObserver = new ResizeObserver(() => {
      handleResize()
    })

    resizeObserver.observe(container)
    window.addEventListener('resize', handleResize)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', handleResize)
    }
  }, [handleResize])

  // バックグラウンド時の描画停止
  useEffect(() => {
    const visibilityHandler = createVisibilityHandler(
      () => {
        // 画面が表示された時、レンダリングを再開
        if (appRef.current) {
          appRef.current.start()
        }
      },
      () => {
        // 画面が非表示になった時、レンダリングを停止
        if (appRef.current) {
          appRef.current.stop()
        }
      }
    )

    visibilityHandler.start()
    return () => visibilityHandler.stop()
  }, [])

  // ドラッグ状態を管理
  const isDraggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const currentAngleRef = useRef(0)

  // 視線追尾（マウス追従）とドラッグで顔の向きを変える
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleMouseMove = (e: MouseEvent) => {
      const model = modelRef.current
      if (!model) return

      // ドラッグ中は左右の向きを適用
      if (isDraggingRef.current) {
        const deltaX = e.clientX - dragStartXRef.current
        // -1 〜 1 の範囲で向きを変える
        const focusX = Math.max(-1, Math.min(1, currentAngleRef.current + deltaX * 0.005))

        // focusController で顔の向きを制御
        try {
          const focusController = (model as any).internalModel?.focusController
          if (focusController) {
            focusController.focus(focusX, 0)
          }
        } catch {
          // 失敗した場合は無視
        }
        return
      }

      // 通常時は視線追尾
      try {
        ;(model as any).focus(e.clientX, e.clientY)
      } catch {
        // focus メソッドがない場合は無視
      }
    }

    const handleMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true
      dragStartXRef.current = e.clientX
      container.style.cursor = 'grabbing'
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        // 現在の向きを保存
        const deltaX = e.clientX - dragStartXRef.current
        currentAngleRef.current = Math.max(-1, Math.min(1, currentAngleRef.current + deltaX * 0.005))
      }
      isDraggingRef.current = false
      container.style.cursor = 'grab'
    }

    const handleMouseLeave = () => {
      const model = modelRef.current
      if (!model) return

      // ドラッグ中でなければ中心を見る
      if (!isDraggingRef.current) {
        const rect = container.getBoundingClientRect()
        const centerX = rect.left + rect.width / 2
        const centerY = rect.top + rect.height / 2
        try {
          ;(model as any).focus(centerX, centerY)
        } catch {
          // focus メソッドがない場合は無視
        }
      }
    }

    // カーソルを設定
    container.style.cursor = 'grab'

    // イベントリスナーを登録
    container.addEventListener('mousemove', handleMouseMove)
    container.addEventListener('mousedown', handleMouseDown)
    container.addEventListener('mouseup', handleMouseUp)
    container.addEventListener('mouseleave', handleMouseLeave)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      container.removeEventListener('mousemove', handleMouseMove)
      container.removeEventListener('mousedown', handleMouseDown)
      container.removeEventListener('mouseup', handleMouseUp)
      container.removeEventListener('mouseleave', handleMouseLeave)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  return (
    <div className={`relative w-full h-full ${className}`}>
      <div
        ref={containerRef}
        className="absolute inset-0"
        data-testid="live2d-canvas"
      />

      {/* ローディング表示 */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-slate-800">
          <div className="text-center">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-600 dark:text-slate-400">
              モデルを読み込み中...
            </p>
          </div>
        </div>
      )}

      {/* エラー表示 */}
      {error && !isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-50 dark:bg-red-900/20">
          <div className="text-center p-4">
            <p className="text-red-600 dark:text-red-400 font-medium mb-2">
              {error}
            </p>
            <p className="text-sm text-red-500 dark:text-red-500">
              モデルパス: {modelPath}
            </p>
          </div>
        </div>
      )}

      {/* プレースホルダー */}
      {showPlaceholder && !isLoading && !error && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900"
          data-testid="live2d-placeholder"
        >
          <div className="w-24 h-24 rounded-full bg-slate-300 dark:bg-slate-600 flex items-center justify-center mb-4">
            <svg
              className="w-12 h-12 text-slate-500 dark:text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          </div>
          <p className="text-slate-600 dark:text-slate-400 font-medium mb-1">
            Live2Dモデル未設定
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-500">
            設定からモデルをインポートしてください
          </p>
        </div>
      )}
    </div>
  )
})
