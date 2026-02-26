import type { Live2DRendererService } from '@/types'
import { MotionPriority } from '@/types'
import { Live2DModel } from '@/lib/live2d/Live2DModel'

/**
 * Live2D Renderer Service 実装
 * Cubism SDK for Web を使用したモデル描画
 */
class Live2DRendererImpl implements Live2DRendererService {
  private canvas: HTMLCanvasElement | null = null
  private gl: WebGLRenderingContext | null = null
  private frameId: number | null = null
  private _modelPath: string | null = null
  private isInitialized: boolean = false
  private model: Live2DModel | null = null
  private lastTime: number = 0
  private onMotionFinishedCallback: (() => void) | null = null

  // SDKが読み込まれているかどうか
  private isSdkLoaded: boolean = false

  // プレースホルダーモード用のモーション情報
  private _currentMotionGroup: string | null = null
  private _currentMotionIndex: number = 0

  /**
   * Live2Dモデルを初期化
   */
  async initialize(canvas: HTMLCanvasElement, modelPath: string): Promise<void> {
    this.canvas = canvas
    this._modelPath = modelPath

    // WebGLコンテキストを取得
    this.gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
    }) as WebGLRenderingContext

    if (!this.gl) {
      throw new Error('WebGL is not supported')
    }

    // Cubism Core SDK が読み込まれているか確認
    this.isSdkLoaded = typeof window !== 'undefined' &&
                        typeof (window as any).Live2DCubismCore !== 'undefined'

    if (!this.isSdkLoaded) {
      console.warn('[Live2DRenderer] Cubism SDK not loaded. Running in placeholder mode.')
      console.warn('[Live2DRenderer] To enable Live2D, place live2dcubismcore.min.js in public/live2d/core/')
    }

    // モデルパスが指定されていて、SDKが読み込まれている場合はモデルを読み込む
    if (modelPath && modelPath !== 'default' && this.isSdkLoaded) {
      try {
        this.model = new Live2DModel(modelPath)
        await this.model.load(this.gl)

        // モーション完了コールバックを設定
        if (this.onMotionFinishedCallback) {
          this.model.setOnMotionFinished(this.onMotionFinishedCallback)
        }
      } catch (error) {
        console.error('[Live2DRenderer] Failed to load model:', error)
        // モデル読み込みに失敗してもプレースホルダーモードで続行
      }
    }

    this.isInitialized = true
    this.lastTime = performance.now()

    // 描画ループを開始
    this.startRendering()
  }

  /**
   * モーションを再生
   */
  startMotion(motionGroup: string, motionIndex: number, _priority: MotionPriority): void {
    if (!this.isInitialized) {
      console.warn('[Live2DRenderer] Not initialized')
      return
    }

    // モーション情報を保存
    this._currentMotionGroup = motionGroup
    this._currentMotionIndex = motionIndex

    if (this.model && this.model.isLoaded()) {
      this.model.startMotion(motionGroup, motionIndex)
    } else {
      // プレースホルダーモード：モーション完了をシミュレート
      console.log(`[Live2DRenderer] Motion: ${motionGroup}[${motionIndex}] (placeholder mode)`)
      setTimeout(() => {
        this.handleMotionFinished()
      }, 2000)
    }
  }

  /**
   * 描画ループを開始
   */
  startRendering(): void {
    if (this.frameId !== null) return

    const render = (currentTime: number) => {
      const deltaTime = (currentTime - this.lastTime) / 1000
      this.lastTime = currentTime

      this.update(deltaTime)
      this.render()

      this.frameId = requestAnimationFrame(render)
    }

    this.frameId = requestAnimationFrame(render)
  }

  /**
   * 描画ループを停止
   */
  stopRendering(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId)
      this.frameId = null
    }
  }

  /**
   * リソースを解放
   */
  dispose(): void {
    this.stopRendering()

    if (this.model) {
      this.model.release()
      this.model = null
    }

    this.canvas = null
    this.gl = null
    this.isInitialized = false
    this._modelPath = null
    this._currentMotionGroup = null
    this._currentMotionIndex = 0
  }

  /**
   * キャンバスサイズを更新
   */
  resize(width: number, height: number): void {
    if (!this.canvas || !this.gl) return

    this.canvas.width = width
    this.canvas.height = height
    this.gl.viewport(0, 0, width, height)

    if (this.model) {
      this.model.resize(width, height)
    }
  }

  /**
   * モーション完了コールバックを設定
   */
  setOnMotionFinished(callback: () => void): void {
    this.onMotionFinishedCallback = callback

    if (this.model) {
      this.model.setOnMotionFinished(callback)
    }
  }

  /**
   * 初期化状態を取得
   */
  getIsInitialized(): boolean {
    return this.isInitialized
  }

  /**
   * 現在のモーショングループを取得
   */
  getCurrentMotionGroup(): string | null {
    return this.model?.getCurrentMotionGroup() ?? this._currentMotionGroup
  }

  /**
   * 現在のモーションインデックスを取得
   */
  getCurrentMotionIndex(): number {
    return this.model?.getCurrentMotionIndex() ?? this._currentMotionIndex
  }

  /**
   * 現在のモデルパスを取得
   */
  getModelPath(): string | null {
    return this._modelPath
  }

  /**
   * 更新処理
   */
  private update(deltaTime: number): void {
    if (this.model && this.model.isLoaded()) {
      this.model.update(deltaTime)
    }
  }

  /**
   * 描画処理
   */
  private render(): void {
    if (!this.gl || !this.canvas) return

    // 画面クリア（透過背景）
    this.gl.clearColor(0.0, 0.0, 0.0, 0.0)
    this.gl.clear(this.gl.COLOR_BUFFER_BIT)

    if (this.model && this.model.isLoaded()) {
      // モデルを描画
      this.model.draw()
    } else {
      // プレースホルダー表示
      this.drawPlaceholder()
    }
  }

  /**
   * プレースホルダーを描画
   * Note: WebGLコンテキストでは2Dテキスト描画ができないため、
   *       背景色のみを描画。テキストはLive2DCanvas.tsxのオーバーレイで表示
   */
  private drawPlaceholder(): void {
    if (!this.gl) return

    // 背景をクリア（透過）
    // Live2DCanvas.tsx側でプレースホルダーUIを表示
    this.gl.clearColor(0.0, 0.0, 0.0, 0.0)
    this.gl.clear(this.gl.COLOR_BUFFER_BIT)
  }

  /**
   * モーション完了時の処理
   */
  private handleMotionFinished(): void {
    if (this.onMotionFinishedCallback) {
      this.onMotionFinishedCallback()
    }
  }
}

/**
 * Live2D Renderer のシングルトンインスタンス
 */
export const live2dRenderer = new Live2DRendererImpl()

/**
 * テスト用にLive2DRendererImplクラスをエクスポート
 */
export { Live2DRendererImpl }
