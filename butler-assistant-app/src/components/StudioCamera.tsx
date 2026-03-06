import { useRef, useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router'
import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import { Face } from 'kalidokit'
import { FaceMesh } from '@mediapipe/face_mesh'
import { Camera } from '@mediapipe/camera_utils'
import { useAppStore } from '@/stores'

// Cubism Core を window に登録
if (typeof window !== 'undefined') {
  ;(window as any).PIXI = PIXI
}

/** Kalidokit → Live2D パラメータ名のマッピング */
const PARAM_NAMES = {
  AngleX: 'ParamAngleX',
  AngleY: 'ParamAngleY',
  AngleZ: 'ParamAngleZ',
  EyeLOpen: 'ParamEyeLOpen',
  EyeROpen: 'ParamEyeROpen',
  EyeBallX: 'ParamEyeBallX',
  EyeBallY: 'ParamEyeBallY',
  BrowLY: 'ParamBrowLY',
  BrowRY: 'ParamBrowRY',
  MouthA: 'ParamA',
  BodyAngleX: 'ParamBodyAngleX',
  BodyAngleY: 'ParamBodyAngleY',
  BodyAngleZ: 'ParamBodyAngleZ',
} as const

const LERP_FACTOR = 0.6

/** 目の開き具合を補正 */
function remapEye(raw: number): number {
  const closeThreshold = 0.1
  const openThreshold = 0.3
  if (raw <= closeThreshold) return 0
  if (raw >= openThreshold) return 1
  return Math.sqrt((raw - closeThreshold) / (openThreshold - closeThreshold))
}

/** 線形補間 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * スタジオ仮想カメラ画面
 *
 * Chrome 拡張によるタブキャプチャ用のクリーンな Live2D 描画ページ。
 * フェイストラッキングでキャラクターを操作し、Meet/Zoom にカメラとして投影する。
 */
export function StudioCamera() {
  const navigate = useNavigate()
  const config = useAppStore((s) => s.config)
  const modelPath = config.model.currentModelId

  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const appRef = useRef<PIXI.Application | null>(null)
  const modelRef = useRef<Live2DModel | null>(null)
  const cameraRef = useRef<Camera | null>(null)
  const targetParamsRef = useRef<Record<string, number>>({})
  const smoothedParamsRef = useRef<Record<string, number>>({})
  const paramIndexCacheRef = useRef<Record<string, number>>({})

  const [status, setStatus] = useState<'loading' | 'ready' | 'tracking' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [showUI, setShowUI] = useState(true)
  const [bgColor, setBgColor] = useState('#16a34a') // 緑（クロマキー向き）
  /** モデルの表示調整（スケール: 0.1〜1.5, 位置: ピクセルオフセット） */
  const [modelScale, setModelScale] = useState(0.45)
  const [modelX, setModelX] = useState(0)   // 中央からのオフセット
  const [modelY, setModelY] = useState(0)   // 中央からのオフセット

  /**
   * 初期化: Live2D + MediaPipe
   */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let isMounted = true
    let pixiApp: PIXI.Application | null = null
    let live2dModel: Live2DModel | null = null
    let faceMesh: FaceMesh | null = null
    let camera: Camera | null = null

    const init = async () => {
      try {
        // PixiJS
        const w = 1280
        const h = 720
        pixiApp = new PIXI.Application({
          backgroundColor: parseInt(bgColor.replace('#', ''), 16),
          width: w,
          height: h,
          antialias: true,
          resolution: 1,
        })
        // @ts-expect-error PixiJS v7 型互換
        container.appendChild(pixiApp.view)
        const canvas = pixiApp.view as HTMLCanvasElement
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        canvas.style.display = 'block'
        canvas.style.objectFit = 'contain'
        appRef.current = pixiApp

        // Live2D
        live2dModel = await Live2DModel.from(modelPath, {
          autoInteract: false,
          autoUpdate: true,
        })
        if (!isMounted) { live2dModel.destroy(); return }
        modelRef.current = live2dModel
        live2dModel.anchor.set(0.5, 0.5)

        const fitScale = Math.min(w / live2dModel.width, h / live2dModel.height)
        const initScale = Math.min(fitScale, 0.45)
        setModelScale(initScale)
        live2dModel.scale.set(initScale)
        live2dModel.x = w / 2
        live2dModel.y = h / 2

        // モーションマネージャーを停止
        const internalModel = (live2dModel as any).internalModel
        if (internalModel) {
          const mm = internalModel.motionManager
          if (mm) { mm.stopAllMotions?.(); mm.update = () => true }
          if (internalModel.focusController) {
            internalModel.focusController.update = () => {}
          }
        }

        // パラメータインデックスキャッシュ
        const coreModel = internalModel?.coreModel
        const ids: string[] | undefined = coreModel?._model?.parameters?.ids
        if (ids) {
          for (const paramName of Object.values(PARAM_NAMES)) {
            const idx = ids.indexOf(paramName)
            if (idx >= 0) paramIndexCacheRef.current[paramName] = idx
          }
        }

        // beforeModelUpdate フック
        if (internalModel?.on) {
          internalModel.on('beforeModelUpdate', () => {
            const core = internalModel.coreModel
            if (!core) return
            const targets = targetParamsRef.current
            const smoothed = smoothedParamsRef.current
            const cache = paramIndexCacheRef.current
            if (Object.keys(targets).length === 0) return
            for (const [paramName, targetValue] of Object.entries(targets)) {
              const prev = smoothed[paramName] ?? targetValue
              const value = lerp(prev, targetValue, LERP_FACTOR)
              smoothed[paramName] = value
              const idx = cache[paramName]
              if (idx !== undefined) core.setParameterValueByIndex(idx, value)
            }
          })
        }

        pixiApp.stage.addChild(live2dModel)

        // MediaPipe FaceMesh
        faceMesh = new FaceMesh({
          locateFile: (file) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
        })
        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        })

        faceMesh.onResults((results) => {
          if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) return
          const landmarks = results.multiFaceLandmarks[0]
          const faceResult = Face.solve(landmarks, {
            runtime: 'mediapipe',
            video: videoRef.current!,
          })
          if (!faceResult) return

          const headX = (faceResult.head.y ?? 0) * 30
          const headY = (faceResult.head.x ?? 0) * 30
          const headZ = (faceResult.head.z ?? 0) * 30

          targetParamsRef.current = {
            [PARAM_NAMES.AngleX]: headX,
            [PARAM_NAMES.AngleY]: headY,
            [PARAM_NAMES.AngleZ]: headZ,
            [PARAM_NAMES.EyeLOpen]: remapEye(Math.max(faceResult.eye.l ?? 1, faceResult.eye.r ?? 1)),
            [PARAM_NAMES.EyeROpen]: remapEye(Math.max(faceResult.eye.l ?? 1, faceResult.eye.r ?? 1)),
            [PARAM_NAMES.EyeBallX]: faceResult.pupil.x ?? 0,
            [PARAM_NAMES.EyeBallY]: faceResult.pupil.y ?? 0,
            [PARAM_NAMES.BrowLY]: faceResult.brow ?? 0,
            [PARAM_NAMES.BrowRY]: faceResult.brow ?? 0,
            [PARAM_NAMES.MouthA]: faceResult.mouth.y ?? 0,
            [PARAM_NAMES.BodyAngleX]: headX * 0.3,
            [PARAM_NAMES.BodyAngleY]: headY * 0.3,
            [PARAM_NAMES.BodyAngleZ]: headZ * 0.3,
          }
        })

        await faceMesh.initialize()

        // カメラ準備
        if (videoRef.current) {
          camera = new Camera(videoRef.current, {
            onFrame: async () => {
              if (videoRef.current && faceMesh) {
                await faceMesh.send({ image: videoRef.current })
              }
            },
            width: 640,
            height: 480,
          })
          cameraRef.current = camera
        }

        if (isMounted) setStatus('ready')
      } catch (err) {
        console.error('[StudioCamera] 初期化エラー:', err)
        if (isMounted) {
          setStatus('error')
          setErrorMsg(err instanceof Error ? err.message : String(err))
        }
      }
    }

    init()

    return () => {
      isMounted = false
      camera?.stop()
      cameraRef.current = null
      if (live2dModel) { live2dModel.destroy(); modelRef.current = null }
      if (pixiApp) {
        pixiApp.destroy(true, { children: true, texture: true, baseTexture: true })
        appRef.current = null
      }
      targetParamsRef.current = {}
      smoothedParamsRef.current = {}
      paramIndexCacheRef.current = {}
    }
  }, [modelPath]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 背景色変更 */
  useEffect(() => {
    const app = appRef.current
    if (app) {
      app.renderer.background.color = parseInt(bgColor.replace('#', ''), 16)
    }
  }, [bgColor])

  /** モデルのスケール・位置を反映 */
  useEffect(() => {
    const model = modelRef.current
    if (!model) return
    model.scale.set(modelScale)
    model.x = 640 + modelX  // 1280/2 = 640
    model.y = 360 + modelY  // 720/2 = 360
  }, [modelScale, modelX, modelY])

  /** トラッキング開始 */
  const startTracking = useCallback(async () => {
    const camera = cameraRef.current
    if (!camera) return
    try {
      await camera.start()
      setStatus('tracking')
    } catch (err) {
      console.error('[StudioCamera] カメラ起動エラー:', err)
      setStatus('error')
      setErrorMsg('カメラの起動に失敗しました。カメラの使用を許可してください。')
    }
  }, [])

  /** トラッキング停止 */
  const stopTracking = useCallback(() => {
    cameraRef.current?.stop()
    targetParamsRef.current = {}
    smoothedParamsRef.current = {}
    setStatus('ready')
  }, [])

  /** ページタイトルを設定（タブ選択時に識別しやすくする） */
  useEffect(() => {
    const prev = document.title
    document.title = 'Ai-Ba Studio Camera'
    return () => { document.title = prev }
  }, [])

  return (
    <div className="relative w-full h-full bg-black">
      {/* Live2D 描画エリア（フルスクリーン） */}
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ background: bgColor }}
      />

      {/* 非表示のカメラ映像（MediaPipe 入力用） */}
      <video
        ref={videoRef}
        className="hidden"
        autoPlay
        playsInline
        muted
      />

      {/* オーバーレイ UI（ホバーまたはクリックで表示切替） */}
      {showUI && (
        <div className="absolute inset-0 pointer-events-none">
          {/* トップバー */}
          <div className="pointer-events-auto absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/aiba')}
                className="px-3 py-1.5 text-sm font-medium text-white bg-white/20 hover:bg-white/30 rounded-lg backdrop-blur-sm transition-colors"
              >
                ← 戻る
              </button>
              <span className="text-white/90 text-sm font-medium">
                Ai-Ba Studio Camera
              </span>
              {status === 'tracking' && (
                <span className="flex items-center gap-1.5 text-xs text-green-400">
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  トラッキング中
                </span>
              )}
            </div>

          </div>

          {/* 左サイドパネル: 位置・スケール調整 */}
          <div className="pointer-events-auto absolute left-3 top-1/2 -translate-y-1/2 flex flex-col gap-3 bg-black/50 backdrop-blur-sm rounded-xl p-3">
            {/* スケール */}
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-white/70">大小</span>
              <input
                type="range"
                min="0.1"
                max="1.5"
                step="0.01"
                value={modelScale}
                onChange={(e) => setModelScale(parseFloat(e.target.value))}
                className="w-20 accent-blue-500"
                style={{ writingMode: 'vertical-lr', direction: 'rtl', height: '80px', width: '20px' }}
              />
            </div>
            {/* 上下 */}
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-white/70">上下</span>
              <input
                type="range"
                min={-2000}
                max={2000}
                step="1"
                value={-modelY}
                onChange={(e) => setModelY(-parseInt(e.target.value))}
                className="w-20 accent-blue-500"
                style={{ writingMode: 'vertical-lr', direction: 'rtl', height: '80px', width: '20px' }}
              />
            </div>
            {/* 左右 */}
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-white/70">左右</span>
              <input
                type="range"
                min={-2000}
                max={2000}
                step="1"
                value={modelX}
                onChange={(e) => setModelX(parseInt(e.target.value))}
                className="accent-blue-500"
                style={{ width: '80px' }}
              />
            </div>
            {/* リセット */}
            <button
              onClick={() => { setModelScale(0.45); setModelX(0); setModelY(0) }}
              className="text-[10px] text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded px-2 py-1 transition-colors"
            >
              リセット
            </button>

            {/* 区切り線 */}
            <div className="w-full h-px bg-white/20" />

            {/* 背景色選択 */}
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-white/70">背景</span>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { color: '#16a34a', label: 'グリーン' },
                  { color: '#2563eb', label: 'ブルー' },
                  { color: '#000000', label: 'ブラック' },
                  { color: '#ffffff', label: 'ホワイト' },
                ].map((opt) => (
                  <button
                    key={opt.color}
                    onClick={() => setBgColor(opt.color)}
                    className={`w-6 h-6 rounded-full border-2 transition-transform ${
                      bgColor === opt.color ? 'border-white scale-110' : 'border-white/40 hover:border-white/70'
                    }`}
                    style={{ background: opt.color }}
                    title={opt.label}
                  />
                ))}
              </div>
            </div>

            {/* 区切り線 */}
            <div className="w-full h-px bg-white/20" />

            {/* トラッキング開始/停止 */}
            {status === 'loading' && (
              <div className="px-2 py-1.5 text-[10px] text-white/70 bg-white/10 rounded-lg text-center">
                読み込み中...
              </div>
            )}
            {status === 'ready' && (
              <button
                onClick={startTracking}
                className="w-full px-2 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                開始
              </button>
            )}
            {status === 'tracking' && (
              <button
                onClick={stopTracking}
                className="w-full px-2 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                停止
              </button>
            )}
            {status === 'error' && (
              <div className="px-2 py-1.5 text-[10px] text-red-300 bg-red-900/50 rounded-lg text-center">
                {errorMsg}
              </div>
            )}

            {/* 区切り線 */}
            <div className="w-full h-px bg-white/20" />

            {/* パネル非表示 */}
            <button
              onClick={() => setShowUI(false)}
              className="w-full flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] text-white/60 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
              title="UIを非表示（クリックで再表示）"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
              </svg>
              非表示
            </button>
          </div>
        </div>
      )}

      {/* UI 非表示時の再表示ボタン */}
      {!showUI && (
        <button
          onClick={() => setShowUI(true)}
          className="absolute top-3 right-3 w-8 h-8 bg-black/30 hover:bg-black/50 rounded-full flex items-center justify-center text-white/50 hover:text-white/90 transition-colors"
          title="UIを表示"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        </button>
      )}
    </div>
  )
}
