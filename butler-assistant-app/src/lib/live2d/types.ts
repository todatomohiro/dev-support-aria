/**
 * Live2D Cubism SDK の型定義
 */

// グローバル型拡張
declare global {
  interface Window {
    Live2DCubismCore: typeof Live2DCubismCore
  }

  namespace Live2DCubismCore {
    class Version {
      static csmGetVersion(): number
      static csmGetLatestMocVersion(): number
    }

    class CubismMoc {
      static create(buffer: ArrayBuffer): CubismMoc
      release(): void
    }

    class CubismModel {
      static create(moc: CubismMoc): CubismModel
      release(): void
      getCanvasWidth(): number
      getCanvasHeight(): number
      getDrawableCount(): number
      getParameterCount(): number
      getPartCount(): number
      update(): void
    }
  }
}

/**
 * Live2Dモデルの設定
 */
export interface Live2DModelConfig {
  /** モデル名 */
  name: string
  /** モデルファイルのパス (.model3.json) */
  path: string
  /** モーション設定 */
  motions?: Record<string, Live2DMotionConfig[]>
  /** 表情設定 */
  expressions?: Live2DExpressionConfig[]
}

/**
 * モーション設定
 */
export interface Live2DMotionConfig {
  /** モーションファイルのパス */
  file: string
  /** フェードイン時間（秒） */
  fadeInTime?: number
  /** フェードアウト時間（秒） */
  fadeOutTime?: number
}

/**
 * 表情設定
 */
export interface Live2DExpressionConfig {
  /** 表情名 */
  name: string
  /** 表情ファイルのパス */
  file: string
}

/**
 * model3.json の構造
 */
export interface Model3Json {
  Version: number
  FileReferences: {
    Moc: string
    Textures: string[]
    Motions?: Record<string, Array<{ File: string; FadeInTime?: number; FadeOutTime?: number }>>
    Expressions?: Array<{ Name: string; File: string }>
    Physics?: string
    Pose?: string
    UserData?: string
  }
  Groups?: Array<{
    Target: string
    Name: string
    Ids: string[]
  }>
  HitAreas?: Array<{
    Name: string
    Id: string
  }>
}

export {}
