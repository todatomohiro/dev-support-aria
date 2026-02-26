import type { MotionControllerService, MotionDefinition } from '@/types'
import { DEFAULT_MOTION_MAPPING, SUPPORTED_MOTION_TAGS } from '@/types'

/**
 * Motion Controller Service 実装
 */
class MotionControllerImpl implements MotionControllerService {
  private currentMotion: string | null = null
  private motionQueue: string[] = []
  private isPlaying: boolean = false
  private completionCallbacks: Array<() => void> = []
  private motionMapping: Record<string, MotionDefinition> = { ...DEFAULT_MOTION_MAPPING }

  /**
   * モーションを再生キューに追加
   */
  playMotion(motionTag: string): void {
    const normalizedTag = this.normalizeMotionTag(motionTag)

    if (this.isPlaying) {
      // モーション再生中はキューに追加
      this.motionQueue.push(normalizedTag)
    } else {
      // 即座に再生開始
      this.startMotion(normalizedTag)
    }
  }

  /**
   * 現在再生中のモーションを取得
   */
  getCurrentMotion(): string | null {
    return this.currentMotion
  }

  /**
   * モーション再生完了時のコールバックを登録
   */
  onMotionComplete(callback: () => void): void {
    this.completionCallbacks.push(callback)
  }

  /**
   * コールバックの登録解除
   */
  offMotionComplete(callback: () => void): void {
    this.completionCallbacks = this.completionCallbacks.filter((cb) => cb !== callback)
  }

  /**
   * 待機モーションに戻る
   */
  returnToIdle(): void {
    this.currentMotion = 'idle'
    this.isPlaying = false
    this.notifyCompletion()
  }

  /**
   * モーションキューの長さを取得
   */
  getQueueLength(): number {
    return this.motionQueue.length
  }

  /**
   * 再生中かどうかを取得
   */
  getIsPlaying(): boolean {
    return this.isPlaying
  }

  /**
   * キューから次のモーションを再生
   */
  playNext(): void {
    if (this.motionQueue.length > 0) {
      const nextMotion = this.motionQueue.shift()!
      this.startMotion(nextMotion)
    } else {
      this.returnToIdle()
    }
  }

  /**
   * モーションマッピングを更新
   */
  setMotionMapping(mapping: Record<string, MotionDefinition>): void {
    this.motionMapping = { ...DEFAULT_MOTION_MAPPING, ...mapping }
  }

  /**
   * モーション定義を取得
   */
  getMotionDefinition(motionTag: string): MotionDefinition | null {
    return this.motionMapping[motionTag] || null
  }

  /**
   * モーション完了を通知（Live2D Rendererから呼ばれる）
   */
  handleMotionFinished(): void {
    this.playNext()
  }

  /**
   * モーションを開始
   */
  private startMotion(motionTag: string): void {
    this.currentMotion = motionTag
    this.isPlaying = true
  }

  /**
   * モーションタグを正規化
   */
  private normalizeMotionTag(motionTag: string): string {
    const normalized = motionTag.toLowerCase().trim()
    if (SUPPORTED_MOTION_TAGS.includes(normalized as (typeof SUPPORTED_MOTION_TAGS)[number])) {
      return normalized
    }
    return 'idle'
  }

  /**
   * 完了コールバックを通知
   */
  private notifyCompletion(): void {
    for (const callback of this.completionCallbacks) {
      callback()
    }
  }

  /**
   * 状態をリセット
   */
  reset(): void {
    this.currentMotion = null
    this.motionQueue = []
    this.isPlaying = false
  }
}

/**
 * Motion Controller のシングルトンインスタンス
 */
export const motionController = new MotionControllerImpl()

/**
 * テスト用にMotionControllerのクラスをエクスポート
 */
export { MotionControllerImpl }
