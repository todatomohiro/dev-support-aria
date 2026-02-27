import type { ConversationHistory } from './message'
import type { ModelConfig, MotionPriority } from './model'
import type { ParsedResponse, StructuredResponse, ValidationResult } from './response'
import type { LLMProvider, UserProfile } from './config'

/**
 * LLM Client Service インターフェース
 */
export interface LLMClientService {
  /**
   * LLMにメッセージを送信し、構造化された回答を取得
   */
  sendMessage(message: string, history?: ConversationHistory): Promise<StructuredResponse>

  /**
   * 使用するLLMプロバイダーを設定
   */
  setProvider(provider: LLMProvider): void

  /**
   * APIキーを設定
   */
  setApiKey(apiKey: string): void

  /**
   * ユーザープロフィールを設定
   */
  setUserProfile(profile: UserProfile): void
}

/**
 * Response Parser Service インターフェース
 */
export interface ResponseParserService {
  /**
   * LLMからのJSON文字列を解析
   */
  parse(jsonString: string): ParsedResponse

  /**
   * レスポンスオブジェクトをJSON文字列にシリアライズ
   */
  serialize(response: ParsedResponse): string

  /**
   * レスポンスの妥当性を検証
   */
  validate(response: unknown): ValidationResult
}

/**
 * Motion Controller Service インターフェース
 */
export interface MotionControllerService {
  /**
   * モーションを再生キューに追加
   */
  playMotion(motionTag: string): void

  /**
   * 現在再生中のモーションを取得
   */
  getCurrentMotion(): string | null

  /**
   * モーション再生完了時のコールバックを登録
   */
  onMotionComplete(callback: () => void): void

  /**
   * 待機モーションに戻る
   */
  returnToIdle(): void
}

/**
 * Live2D Renderer Service インターフェース
 */
export interface Live2DRendererService {
  /**
   * Live2Dモデルを初期化
   */
  initialize(canvas: HTMLCanvasElement, modelPath: string): Promise<void>

  /**
   * モーションを再生
   */
  startMotion(motionGroup: string, motionIndex: number, priority: MotionPriority): void

  /**
   * 描画ループを開始
   */
  startRendering(): void

  /**
   * 描画ループを停止
   */
  stopRendering(): void

  /**
   * リソースを解放
   */
  dispose(): void

  /**
   * キャンバスサイズを更新
   */
  resize(width: number, height: number): void
}

/**
 * Model Loader Service インターフェース
 */
export interface ModelLoaderService {
  /**
   * Live2Dモデルを読み込み
   */
  loadModel(files: File[]): Promise<ModelConfig>

  /**
   * モデルファイルの妥当性を検証
   */
  validateModelFiles(files: File[]): ValidationResult

  /**
   * モデルをストレージに保存
   */
  saveModel(modelConfig: ModelConfig): Promise<void>

  /**
   * 保存されたモデル一覧を取得
   */
  listModels(): Promise<ModelConfig[]>
}

/**
 * ファイル選択オプション
 */
export interface FileSelectOptions {
  multiple?: boolean
  accept?: string
}

/**
 * プラットフォームアダプターインターフェース
 */
export interface PlatformAdapter {
  saveSecureData(key: string, value: string): Promise<void>
  loadSecureData(key: string): Promise<string | null>
  selectFile(options: FileSelectOptions): Promise<File | null>
}
