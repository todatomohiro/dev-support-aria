import { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react'
import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import { createVisibilityHandler, throttle, createFPSCounter } from '@/utils/performance'

// Cubism Core を window に登録（pixi-live2d-display が必要とする）
if (typeof window !== 'undefined') {
  ;(window as any).PIXI = PIXI
}

/** モバイルレイアウト判定の高さ閾値（px） */
const MOBILE_HEIGHT_THRESHOLD = 350
/** デスクトップ時の最大スケール */
const DESKTOP_MAX_SCALE = 0.5

/**
 * コンテナサイズに応じてモデルのスケールと位置を設定
 *
 * - モバイル（高さ < 300px）: 幅に合わせて拡大し、上半身をクローズアップ表示
 * - デスクトップ: コンテナ内に全身を収める
 */
function applyModelLayout(
  model: Live2DModel,
  containerW: number,
  containerH: number,
  originalW: number,
  originalH: number
): void {
  if (containerH < MOBILE_HEIGHT_THRESHOLD) {
    // モバイル: 上半身クローズアップ（幅基準でスケール、下半身はクリップ）
    const widthScale = containerW / originalW
    const scale = Math.min(widthScale * 0.8, 1.0)
    model.scale.set(scale)
    model.x = containerW / 2
    // モデル上部を表示エリア上方に配置（上半身〜腰が見える位置）
    model.y = originalH * scale * 0.4
  } else {
    // デスクトップ: コンテナ内に全身を収める
    const fitScale = Math.min(containerW / originalW, containerH / originalH)
    const scale = Math.min(fitScale, DESKTOP_MAX_SCALE)
    model.scale.set(scale)
    model.x = containerW / 2
    model.y = containerH / 2
  }
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
  /** リップシンク用: 口の開き具合を設定（0=閉 〜 1=全開） */
  setMouthOpenness: (value: number) => void
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
  /** リップシンク用: 現在の口の開き具合（0〜1） */
  const mouthOpennessRef = useRef(0)
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
    setMouthOpenness: (value: number) => {
      mouthOpennessRef.current = value
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
        // モバイル端末を検出し解像度を制限
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
        const resolution = isMobile
          ? Math.min(window.devicePixelRatio, 1.5)
          : window.devicePixelRatio

        // PixiJS アプリケーションを作成（resizeTo は使わず手動管理）
        const initWidth = container.clientWidth || 1
        const initHeight = container.clientHeight || 1
        app = new PIXI.Application({
          backgroundAlpha: 0,
          width: initWidth,
          height: initHeight,
          antialias: true,
          resolution,
        })

        // @ts-expect-error - PixiJS v7 の型との互換性
        container.appendChild(app.view)
        // Canvas をコンテナ全体に収める
        const canvas = app.view as HTMLCanvasElement
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        canvas.style.display = 'block'
        appRef.current = app

        // DEV モード: FPS 計測ログ
        if (import.meta.env.DEV) {
          const fpsCounter = createFPSCounter()
          const fpsLogInterval = setInterval(() => {
            if (app && !app.stage.destroyed) {
              console.log(`[Live2DCanvas] FPS: ${fpsCounter.getFPS()}`)
            }
          }, 5000)
          app.ticker.add(() => fpsCounter.update())
          // クリーンアップ用にインターバルIDを保存
          ;(app as any).__fpsLogInterval = fpsLogInterval
        }

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

            // モデルのサイズと位置を調整
            model.anchor.set(0.5, 0.5)
            applyModelLayout(model, container.clientWidth, container.clientHeight, model.width, model.height)

            // リップシンク: 毎フレーム口の開きを反映
            // beforeModelUpdate イベント（モーション適用後・描画前）を優先し、
            // 未サポート時は PIXI Ticker でフォールバック
            const internalModel = (model as any).internalModel
            const applyLipSync = () => {
              const v = mouthOpennessRef.current
              const coreModel = internalModel?.coreModel
              if (!coreModel) return
              // パラメータインデックスを直接探してセット（CubismId 非依存）
              const ids: string[] | undefined = coreModel._model?.parameters?.ids
              if (ids) {
                const idx = ids.indexOf('ParamA')
                if (idx >= 0) {
                  coreModel.setParameterValueByIndex(idx, v)
                  return
                }
              }
              // フォールバック: setParameterValueById を試行
              try {
                coreModel.setParameterValueById('ParamA', v)
              } catch {
                // パラメータが見つからない場合は無視
              }
            }

            if (internalModel?.on) {
              internalModel.on('beforeModelUpdate', applyLipSync)
            } else {
              // イベント未サポート時は PIXI Ticker で代替
              app.ticker.add(applyLipSync)
            }

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
        // FPS 計測ログのクリーンアップ
        if ((app as any).__fpsLogInterval) {
          clearInterval((app as any).__fpsLogInterval)
        }
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
    const app = appRef.current
    const model = modelRef.current
    const originalSize = originalSizeRef.current
    if (!container) return

    const w = container.clientWidth
    const h = container.clientHeight
    if (w === 0 || h === 0) return

    // レンダラーのバッファサイズを更新
    if (app) {
      app.renderer.resize(w, h)
    }

    if (!model || !originalSize) return

    applyModelLayout(model, w, h, originalSize.width, originalSize.height)
  }, [])

  // ResizeObserver でコンテナサイズの変更を監視（スロットル付き）
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const throttledResize = throttle(handleResize, 100)

    const resizeObserver = new ResizeObserver(() => {
      throttledResize()
    })

    resizeObserver.observe(container)
    window.addEventListener('resize', throttledResize)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', throttledResize)
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
    <div className={`relative w-full h-full overflow-hidden ${className}`}>
      <div
        ref={containerRef}
        className="w-full h-full"
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
