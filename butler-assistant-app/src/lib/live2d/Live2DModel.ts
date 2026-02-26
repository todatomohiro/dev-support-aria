/**
 * Live2D Model クラス
 * Cubism SDK for Web を使用したモデル管理
 */

import type { Model3Json } from './types'

/**
 * Live2Dモデルを管理するクラス
 */
export class Live2DModel {
  private modelPath: string
  private modelHomeDir: string
  private modelJson: Model3Json | null = null
  private moc: any = null
  private model: any = null
  private textures: WebGLTexture[] = []
  private gl: WebGLRenderingContext | null = null

  // モーション管理
  private currentMotionGroup: string | null = null
  private currentMotionIndex: number = 0
  private motionFinishedCallback: (() => void) | null = null

  // モデルのマトリックス
  private modelMatrix: Float32Array = new Float32Array(16)
  private projectionMatrix: Float32Array = new Float32Array(16)

  constructor(modelPath: string) {
    this.modelPath = modelPath
    // モデルのホームディレクトリを取得
    const lastSlash = modelPath.lastIndexOf('/')
    this.modelHomeDir = lastSlash >= 0 ? modelPath.substring(0, lastSlash + 1) : ''
  }

  /**
   * モデルを読み込む
   */
  async load(gl: WebGLRenderingContext): Promise<void> {
    this.gl = gl

    // Cubism Core が読み込まれているか確認
    if (typeof window.Live2DCubismCore === 'undefined') {
      throw new Error('Live2D Cubism Core is not loaded. Please include live2dcubismcore.min.js')
    }

    // model3.json を読み込む
    const response = await fetch(this.modelPath)
    if (!response.ok) {
      throw new Error(`Failed to load model: ${this.modelPath}`)
    }
    this.modelJson = await response.json()

    if (!this.modelJson) {
      throw new Error('Invalid model3.json')
    }

    // MOC ファイルを読み込む
    const mocPath = this.modelHomeDir + this.modelJson.FileReferences.Moc
    const mocResponse = await fetch(mocPath)
    if (!mocResponse.ok) {
      throw new Error(`Failed to load moc: ${mocPath}`)
    }
    const mocArrayBuffer = await mocResponse.arrayBuffer()

    // MOC を作成
    this.moc = window.Live2DCubismCore.CubismMoc.create(mocArrayBuffer)
    if (!this.moc) {
      throw new Error('Failed to create CubismMoc')
    }

    // モデルを作成
    this.model = window.Live2DCubismCore.CubismModel.create(this.moc)
    if (!this.model) {
      throw new Error('Failed to create CubismModel')
    }

    // テクスチャを読み込む
    await this.loadTextures()

    // マトリックスを初期化
    this.initializeMatrices()

    console.log('[Live2DModel] Model loaded successfully:', this.modelPath)
  }

  /**
   * テクスチャを読み込む
   */
  private async loadTextures(): Promise<void> {
    if (!this.gl || !this.modelJson) return

    const texturePaths = this.modelJson.FileReferences.Textures
    this.textures = []

    for (const texturePath of texturePaths) {
      const fullPath = this.modelHomeDir + texturePath
      const texture = await this.loadTexture(fullPath)
      this.textures.push(texture)
    }
  }

  /**
   * 単一のテクスチャを読み込む
   */
  private loadTexture(path: string): Promise<WebGLTexture> {
    return new Promise((resolve, reject) => {
      if (!this.gl) {
        reject(new Error('WebGL context not available'))
        return
      }

      const gl = this.gl
      const img = new Image()
      img.crossOrigin = 'anonymous'

      img.onload = () => {
        const texture = gl.createTexture()
        if (!texture) {
          reject(new Error('Failed to create texture'))
          return
        }

        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.bindTexture(gl.TEXTURE_2D, null)

        resolve(texture)
      }

      img.onerror = () => {
        reject(new Error(`Failed to load texture: ${path}`))
      }

      img.src = path
    })
  }

  /**
   * マトリックスを初期化
   */
  private initializeMatrices(): void {
    // 単位行列で初期化
    this.identity(this.modelMatrix)
    this.identity(this.projectionMatrix)
  }

  /**
   * 単位行列を作成
   */
  private identity(matrix: Float32Array): void {
    matrix.fill(0)
    matrix[0] = 1
    matrix[5] = 1
    matrix[10] = 1
    matrix[15] = 1
  }

  /**
   * モーションを開始
   */
  startMotion(group: string, index: number): void {
    this.currentMotionGroup = group
    this.currentMotionIndex = index

    // モーション完了をシミュレート（実際のSDKではコールバックを使用）
    // TODO: 実際のモーションシステムと統合
    setTimeout(() => {
      if (this.motionFinishedCallback) {
        this.motionFinishedCallback()
      }
    }, 2000)
  }

  /**
   * モーション完了コールバックを設定
   */
  setOnMotionFinished(callback: () => void): void {
    this.motionFinishedCallback = callback
  }

  /**
   * モデルを更新
   */
  update(deltaTime: number): void {
    if (!this.model) return

    // パラメータの更新（呼吸アニメーションなど）
    // TODO: 実際のパラメータ更新を実装

    // モデルの更新
    this.model.update()
  }

  /**
   * モデルを描画
   */
  draw(): void {
    if (!this.gl || !this.model) return

    // TODO: 実際の描画処理を実装
    // Cubism SDK の Renderer を使用して描画
  }

  /**
   * リサイズ処理
   */
  resize(width: number, height: number): void {
    if (!this.model) return

    // プロジェクション行列を更新
    const aspectRatio = width / height
    this.identity(this.projectionMatrix)
    this.projectionMatrix[0] = 1 / aspectRatio
  }

  /**
   * リソースを解放
   */
  release(): void {
    // テクスチャを解放
    if (this.gl) {
      for (const texture of this.textures) {
        this.gl.deleteTexture(texture)
      }
    }
    this.textures = []

    // モデルを解放
    if (this.model) {
      this.model.release()
      this.model = null
    }

    // MOC を解放
    if (this.moc) {
      this.moc.release()
      this.moc = null
    }

    this.gl = null
    this.modelJson = null
  }

  /**
   * 現在のモーショングループを取得
   */
  getCurrentMotionGroup(): string | null {
    return this.currentMotionGroup
  }

  /**
   * 現在のモーションインデックスを取得
   */
  getCurrentMotionIndex(): number {
    return this.currentMotionIndex
  }

  /**
   * モデルが読み込まれているかどうか
   */
  isLoaded(): boolean {
    return this.model !== null
  }
}
