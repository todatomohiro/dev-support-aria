/**
 * モーション優先度
 */
export enum MotionPriority {
  NONE = 0,
  IDLE = 1,
  NORMAL = 2,
  FORCE = 3,
}

/**
 * モーション定義
 */
export interface MotionDefinition {
  group: string
  index: number
  file: string
}

/**
 * モーションマッピング
 */
export interface MotionMapping {
  [motionTag: string]: MotionDefinition
}

/**
 * Live2Dモデル設定
 */
export interface ModelConfig {
  id: string
  name: string
  modelPath: string
  textures: string[]
  motions: MotionMapping
  createdAt: number
}

/**
 * デフォルトモーションマッピング
 */
export const DEFAULT_MOTION_MAPPING: MotionMapping = {
  idle: { group: 'Idle', index: 0, file: 'idle.motion3.json' },
  bow: { group: 'TapBody', index: 0, file: 'bow.motion3.json' },
  smile: { group: 'TapBody', index: 1, file: 'smile.motion3.json' },
  think: { group: 'TapBody', index: 2, file: 'think.motion3.json' },
  nod: { group: 'TapBody', index: 3, file: 'nod.motion3.json' },
}

/**
 * サポートされるモーションタグ
 */
export const SUPPORTED_MOTION_TAGS = ['idle', 'bow', 'smile', 'think', 'nod'] as const
export type MotionTag = (typeof SUPPORTED_MOTION_TAGS)[number]
