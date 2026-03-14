import { getIdToken } from '@/auth'

/** サーバー上のモデル情報 */
export interface ServerModel {
  modelId: string
  name: string
  description: string
  modelUrl: string
  s3Prefix: string
  modelFile: string
  emotionMapping: Record<string, string>
  motionMapping: Record<string, { group: string; index: number }>
  modelTier?: string
  avatarUrl?: string
  characterConfig?: {
    characterName: string
    characterAge: string
    characterGender: string
    characterPersonality: string
    characterSpeechStyle: string
    characterPrompt: string
  }
}

/**
 * モデル選択サービス
 * サーバーから有効なモデル一覧を取得し、ユーザーの選択を管理する
 */
class ModelServiceImpl {
  /**
   * 有効なモデル一覧を取得
   */
  async listModels(): Promise<ServerModel[]> {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
    const token = await getIdToken()
    if (!apiBaseUrl || !token) return []

    const res = await fetch(`${apiBaseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!res.ok) {
      throw new Error(`Failed to fetch models: ${res.status}`)
    }

    const data = await res.json()
    return data.models ?? []
  }
}

export const modelService = new ModelServiceImpl()
export { ModelServiceImpl }
