import { v4 as uuidv4 } from 'uuid'
import type { ModelLoaderService, ModelConfig, ValidationResult, FieldValidationError } from '@/types'
import { ModelLoadError, DEFAULT_MOTION_MAPPING } from '@/types'

/**
 * モデルファイルのストレージキー
 */
const MODELS_STORAGE_KEY = 'butler-app-models'

/**
 * Model Loader Service 実装
 */
class ModelLoaderImpl implements ModelLoaderService {
  /**
   * Live2Dモデルを読み込み
   */
  async loadModel(files: File[]): Promise<ModelConfig> {
    // ファイルの妥当性を検証
    const validationResult = this.validateModelFiles(files)
    if (!validationResult.isValid) {
      throw new ModelLoadError(
        'モデルファイルの検証に失敗しました',
        validationResult.errors
      )
    }

    // .model3.jsonファイルを探す
    const modelFile = files.find((f) => f.name.endsWith('.model3.json'))
    if (!modelFile) {
      throw new ModelLoadError('model3.jsonファイルが見つかりません')
    }

    // model3.jsonを読み込み
    const modelJson = await this.readJsonFile(modelFile)

    // テクスチャファイルを抽出
    const textures = files
      .filter((f) => f.name.endsWith('.png') || f.name.endsWith('.jpg'))
      .map((f) => f.name)

    // モデル設定を作成
    const modelConfig: ModelConfig = {
      id: uuidv4(),
      name: modelFile.name.replace('.model3.json', ''),
      modelPath: modelFile.name,
      textures,
      motions: this.extractMotions(modelJson, files),
      createdAt: Date.now(),
    }

    return modelConfig
  }

  /**
   * モデルファイルの妥当性を検証
   */
  validateModelFiles(files: File[]): ValidationResult {
    const errors: FieldValidationError[] = []

    if (files.length === 0) {
      errors.push({
        field: 'files',
        message: 'ファイルが選択されていません',
      })
      return { isValid: false, errors }
    }

    // .model3.jsonファイルの存在確認
    const hasModelFile = files.some((f) => f.name.endsWith('.model3.json'))
    if (!hasModelFile) {
      errors.push({
        field: 'modelFile',
        message: '.model3.jsonファイルが必要です',
      })
    }

    // テクスチャファイルの存在確認
    const hasTexture = files.some(
      (f) => f.name.endsWith('.png') || f.name.endsWith('.jpg')
    )
    if (!hasTexture) {
      errors.push({
        field: 'textures',
        message: 'テクスチャファイル（.png または .jpg）が必要です',
      })
    }

    return {
      isValid: errors.length === 0,
      errors,
    }
  }

  /**
   * モデルをストレージに保存
   */
  async saveModel(modelConfig: ModelConfig): Promise<void> {
    const models = await this.listModels()
    const existingIndex = models.findIndex((m) => m.id === modelConfig.id)

    if (existingIndex >= 0) {
      models[existingIndex] = modelConfig
    } else {
      models.push(modelConfig)
    }

    localStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(models))
  }

  /**
   * 保存されたモデル一覧を取得
   */
  async listModels(): Promise<ModelConfig[]> {
    const stored = localStorage.getItem(MODELS_STORAGE_KEY)
    if (!stored) {
      return []
    }

    try {
      return JSON.parse(stored) as ModelConfig[]
    } catch {
      return []
    }
  }

  /**
   * モデルを削除
   */
  async deleteModel(modelId: string): Promise<void> {
    const models = await this.listModels()
    const filtered = models.filter((m) => m.id !== modelId)
    localStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(filtered))
  }

  /**
   * モデルを取得
   */
  async getModel(modelId: string): Promise<ModelConfig | null> {
    const models = await this.listModels()
    return models.find((m) => m.id === modelId) || null
  }

  /**
   * JSONファイルを読み込む
   */
  private async readJsonFile(file: File): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const json = JSON.parse(reader.result as string)
          resolve(json)
        } catch (error) {
          reject(new ModelLoadError('JSONファイルの解析に失敗しました', error))
        }
      }
      reader.onerror = () => {
        reject(new ModelLoadError('ファイルの読み込みに失敗しました'))
      }
      reader.readAsText(file)
    })
  }

  /**
   * モーション定義を抽出
   */
  private extractMotions(
    modelJson: Record<string, unknown>,
    files: File[]
  ): ModelConfig['motions'] {
    const motions = { ...DEFAULT_MOTION_MAPPING }

    // model3.jsonからモーショングループを抽出
    const fileReferences = modelJson.FileReferences as Record<string, unknown> | undefined
    const motionGroups = fileReferences?.Motions as Record<string, Array<{ File: string }>> | undefined

    if (motionGroups) {
      for (const [groupName, motionList] of Object.entries(motionGroups)) {
        for (let i = 0; i < motionList.length; i++) {
          const motionFile = motionList[i].File
          // ファイルが存在するか確認
          const exists = files.some((f) => f.name === motionFile || f.name.endsWith(motionFile))
          if (exists) {
            // グループ名をモーションタグとしてマッピング
            const tag = groupName.toLowerCase()
            motions[tag] = {
              group: groupName,
              index: i,
              file: motionFile,
            }
          }
        }
      }
    }

    return motions
  }
}

/**
 * Model Loader のシングルトンインスタンス
 */
export const modelLoader = new ModelLoaderImpl()

/**
 * テスト用にModelLoaderImplクラスをエクスポート
 */
export { ModelLoaderImpl }
