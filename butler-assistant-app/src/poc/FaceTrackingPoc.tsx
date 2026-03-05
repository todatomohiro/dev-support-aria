import { useRef, useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router'
import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import { Face } from 'kalidokit'
import { FaceMesh } from '@mediapipe/face_mesh'
import { Camera } from '@mediapipe/camera_utils'

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

/** パラメータスムージング用の係数（0〜1、大きいほど追従が速い） */
const LERP_FACTOR = 0.6

/**
 * 目の開き具合を補正する
 *
 * Kalidokit の eye 値は 0〜1 だが、普通に開けていても 0.5〜0.7 程度になりがち。
 * 閾値以下を「閉じた」、それ以上を「開いている」に再マッピングして感度を調整する。
 *
 * @param raw Kalidokit の eye 値（0〜1）
 * @param closeThreshold この値以下で完全に閉じたとみなす（デフォルト: 0.2）
 * @param openThreshold この値以上で完全に開いたとみなす（デフォルト: 0.8）
 */
function remapEye(raw: number): number {
  // 0.1 未満でないと閉じない、0.3 以上で全開
  // さらに開く方向を強くするため pow で曲線補正
  const closeThreshold = 0.1
  const openThreshold = 0.3
  if (raw <= closeThreshold) return 0
  if (raw >= openThreshold) return 1
  const t = (raw - closeThreshold) / (openThreshold - closeThreshold)
  // sqrt で開く側に寄せる（t=0.5 → 0.71）
  return Math.sqrt(t)
}

/** 線形補間 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * フェイストラッキング PoC
 *
 * MediaPipe Face Mesh でカメラ映像から顔ランドマークを検出し、
 * Kalidokit で Live2D パラメータに変換してキャラクターを制御する。
 */
export function FaceTrackingPoc() {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const live2dContainerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<PIXI.Application | null>(null)
  const modelRef = useRef<Live2DModel | null>(null)
  const cameraRef = useRef<Camera | null>(null)

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [tracking, setTracking] = useState(false)
  const [debugInfo, setDebugInfo] = useState<Record<string, number>>({})

  /**
   * 毎フレーム適用するターゲットパラメータ（FaceMesh → Kalidokit の結果を格納）
   * beforeModelUpdate フックから参照するため ref で保持
   */
  const targetParamsRef = useRef<Record<string, number>>({})
  /** 現在のスムージング済みパラメータ値 */
  const smoothedParamsRef = useRef<Record<string, number>>({})
  /** パラメータインデックスのキャッシュ（毎フレーム indexOf を避ける） */
  const paramIndexCacheRef = useRef<Record<string, number>>({})
  /** デバッグ表示の更新カウンタ（毎フレームの setState を避ける） */
  const debugCounterRef = useRef(0)

  /**
   * 初期化: Live2D + MediaPipe + Camera
   */
  useEffect(() => {
    const container = live2dContainerRef.current
    if (!container) return

    let isMounted = true
    let pixiApp: PIXI.Application | null = null
    let live2dModel: Live2DModel | null = null
    let faceMesh: FaceMesh | null = null
    let camera: Camera | null = null

    const init = async () => {
      try {
        // 1. PixiJS アプリ作成
        const w = container.clientWidth || 400
        const h = container.clientHeight || 500
        pixiApp = new PIXI.Application({
          backgroundAlpha: 0,
          width: w,
          height: h,
          antialias: true,
          resolution: Math.min(window.devicePixelRatio, 2),
        })

        // @ts-expect-error PixiJS v7 型互換
        container.appendChild(pixiApp.view)
        const canvas = pixiApp.view as HTMLCanvasElement
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        canvas.style.display = 'block'
        appRef.current = pixiApp

        // 2. Live2D モデル読み込み
        const modelPath = '/models/mao_pro_jp/mao_pro.model3.json'
        live2dModel = await Live2DModel.from(modelPath, {
          autoInteract: false,
          autoUpdate: true,
        })

        if (!isMounted) {
          live2dModel.destroy()
          return
        }

        modelRef.current = live2dModel
        live2dModel.anchor.set(0.5, 0.5)

        // サイズ調整
        const fitScale = Math.min(w / live2dModel.width, h / live2dModel.height)
        const scale = Math.min(fitScale, 0.45)
        live2dModel.scale.set(scale)
        live2dModel.x = w / 2
        live2dModel.y = h / 2

        // --- モーションマネージャーを停止してフェイストラッキングが上書きされないようにする ---
        const internalModel = (live2dModel as any).internalModel
        if (internalModel) {
          // モーションマネージャーのモーション再生を停止
          const motionManager = internalModel.motionManager
          if (motionManager) {
            // 現在のモーションを停止
            motionManager.stopAllMotions?.()
            // update を空にしてモーションによるパラメータ上書きを防ぐ
            motionManager.update = () => true
          }

          // フォーカスコントローラー（視線追従）を無効化
          if (internalModel.focusController) {
            internalModel.focusController.update = () => {}
          }
        }

        // パラメータインデックスをキャッシュ
        const coreModel = internalModel?.coreModel
        const ids: string[] | undefined = coreModel?._model?.parameters?.ids
        if (ids) {
          for (const paramName of Object.values(PARAM_NAMES)) {
            const idx = ids.indexOf(paramName)
            if (idx >= 0) {
              paramIndexCacheRef.current[paramName] = idx
            }
          }
          console.log('[FaceTrackingPoc] パラメータインデックスキャッシュ:', paramIndexCacheRef.current)
        }

        // --- beforeModelUpdate フックでフェイストラッキング値を毎フレーム適用 ---
        if (internalModel?.on) {
          internalModel.on('beforeModelUpdate', () => {
            const core = internalModel.coreModel
            if (!core) return

            const targets = targetParamsRef.current
            const smoothed = smoothedParamsRef.current
            const cache = paramIndexCacheRef.current

            // ターゲット値が空（まだトラッキングしていない）なら何もしない
            if (Object.keys(targets).length === 0) return

            for (const [paramName, targetValue] of Object.entries(targets)) {
              // スムージング
              const prev = smoothed[paramName] ?? targetValue
              const value = lerp(prev, targetValue, LERP_FACTOR)
              smoothed[paramName] = value

              const idx = cache[paramName]
              if (idx !== undefined) {
                core.setParameterValueByIndex(idx, value)
              }
            }
          })
        }

        pixiApp.stage.addChild(live2dModel)

        // 3. MediaPipe FaceMesh 初期化
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

          // Kalidokit で顔パラメータに変換
          const faceResult = Face.solve(landmarks, {
            runtime: 'mediapipe',
            video: videoRef.current!,
          })

          if (!faceResult) return

          // ターゲットパラメータを更新（beforeModelUpdate で毎フレーム適用される）
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
            // 体の回転（頭の30%程度で自然な連動）
            [PARAM_NAMES.BodyAngleX]: headX * 0.3,
            [PARAM_NAMES.BodyAngleY]: headY * 0.3,
            [PARAM_NAMES.BodyAngleZ]: headZ * 0.3,
          }

          // デバッグ表示（10フレームに1回更新して負荷を抑える）
          debugCounterRef.current++
          if (debugCounterRef.current % 10 === 0) {
            setDebugInfo({
              headX: Math.round(headX * 10) / 10,
              headY: Math.round(headY * 10) / 10,
              headZ: Math.round(headZ * 10) / 10,
              eyeL: Math.round(remapEye(faceResult.eye.l ?? 1) * 100) / 100,
              eyeR: Math.round(remapEye(faceResult.eye.r ?? 1) * 100) / 100,
              pupilX: Math.round((faceResult.pupil.x ?? 0) * 100) / 100,
              pupilY: Math.round((faceResult.pupil.y ?? 0) * 100) / 100,
              mouth: Math.round((faceResult.mouth.y ?? 0) * 100) / 100,
            })
          }
        })

        await faceMesh.initialize()

        // 4. カメラ準備（まだ開始しない）
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

          if (isMounted) {
            setStatus('ready')
          }
        }
      } catch (err) {
        console.error('[FaceTrackingPoc] 初期化エラー:', err)
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
      if (live2dModel) {
        live2dModel.destroy()
        modelRef.current = null
      }
      if (pixiApp) {
        pixiApp.destroy(true, { children: true, texture: true, baseTexture: true })
        appRef.current = null
      }
      targetParamsRef.current = {}
      smoothedParamsRef.current = {}
      paramIndexCacheRef.current = {}
    }
  }, [])

  /**
   * トラッキング開始/停止
   */
  const toggleTracking = useCallback(async () => {
    const camera = cameraRef.current
    if (!camera) return

    if (tracking) {
      camera.stop()
      setTracking(false)
      // パラメータをリセット
      targetParamsRef.current = {}
      smoothedParamsRef.current = {}
      setDebugInfo({})
    } else {
      try {
        await camera.start()
        setTracking(true)
      } catch (err) {
        console.error('[FaceTrackingPoc] カメラ起動エラー:', err)
        setStatus('error')
        setErrorMsg(err instanceof Error ? err.message : 'カメラの起動に失敗しました。カメラの使用を許可してください。')
      }
    }
  }, [tracking])

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto w-full space-y-4">
        {/* ヘッダー */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            キャラクター操作テスト
          </h1>
          <button
            onClick={() => navigate('/poc')}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
          >
            ← 戻る
          </button>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400">
          カメラで顔を映すと、キャラクターが同じ動きをします（MediaPipe + Kalidokit）
        </p>

        {/* ステータス */}
        {status === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            モデルとカメラを準備中...
          </div>
        )}
        {status === 'error' && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm rounded-lg">
            エラー: {errorMsg}
          </div>
        )}

        {/* コントロール */}
        {status === 'ready' && (
          <button
            onClick={toggleTracking}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              tracking
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-blue-500 hover:bg-blue-600 text-white'
            }`}
          >
            {tracking ? 'トラッキング停止' : 'トラッキング開始'}
          </button>
        )}

        {/* メインエリア */}
        <div className="flex flex-col md:flex-row gap-4">
          {/* カメラプレビュー */}
          <div className="md:w-1/3">
            <div className="bg-black rounded-lg overflow-hidden aspect-[4/3]">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                autoPlay
                playsInline
                muted
                style={{ transform: 'scaleX(-1)' }}
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-center">
              カメラ映像
            </p>
          </div>

          {/* Live2D キャラクター */}
          <div className="md:w-2/3">
            <div
              ref={live2dContainerRef}
              className="bg-gradient-to-b from-blue-50 to-purple-50 dark:from-gray-800 dark:to-gray-900 rounded-lg overflow-hidden"
              style={{ height: '400px' }}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-center">
              Live2D キャラクター
            </p>
          </div>
        </div>

        {/* デバッグ情報 */}
        {tracking && Object.keys(debugInfo).length > 0 && (
          <div className="bg-gray-800 text-green-400 p-3 rounded-lg text-xs font-mono space-y-1">
            <div className="font-bold text-gray-300 mb-2">パラメータモニター</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1">
              {Object.entries(debugInfo).map(([key, value]) => (
                <div key={key} className="flex justify-between">
                  <span className="text-gray-400">{key}:</span>
                  <span>{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 解説 */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 text-sm text-gray-600 dark:text-gray-300 space-y-2">
          <h3 className="font-medium text-gray-900 dark:text-gray-100">仕組み</h3>
          <ol className="list-decimal list-inside space-y-1">
            <li>カメラ映像を <strong>MediaPipe Face Mesh</strong> で解析（468点のランドマーク検出）</li>
            <li><strong>Kalidokit</strong> でランドマークを Live2D パラメータに変換</li>
            <li>頭の回転・まばたき・視線・口の開閉・体の連動をリアルタイムで反映</li>
          </ol>
          <h3 className="font-medium text-gray-900 dark:text-gray-100 mt-3">対応パラメータ</h3>
          <ul className="list-disc list-inside space-y-0.5 text-xs">
            <li>頭の回転（X/Y/Z軸）+ 体の連動</li>
            <li>まばたき（左右独立）</li>
            <li>視線（瞳の方向）</li>
            <li>眉の上下</li>
            <li>口の開閉</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
