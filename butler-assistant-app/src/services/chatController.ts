import { v4 as uuidv4 } from 'uuid'
import { llmClient } from './llmClient'
import { motionController } from './motionController'
import { syncService } from './syncService'
import { ttsService } from './ttsService'
import { useAppStore } from '@/stores/appStore'
import { useAuthStore } from '@/auth/authStore'
import type { Message, StructuredResponse, ConversationHistory, AppError } from '@/types'
import { NetworkError, APIError, RateLimitError, ParseError } from '@/types'
import { measurePerformanceAsync } from '@/utils/performance'

/**
 * エラー種別に対応するモーションタグ
 */
const ERROR_MOTIONS: Record<string, string> = {
  network: 'bow',
  api: 'bow',
  rateLimit: 'nervous',
  parse: 'confused',
  default: 'bow',
}

/**
 * Chat Controller Service
 * メッセージ送信からモーション再生までの一連のフローを管理
 */
class ChatControllerImpl {
  /**
   * メッセージを送信し、レスポンスを処理
   */
  async sendMessage(content: string, imageBase64?: string): Promise<void> {
    const store = useAppStore.getState()

    // 空メッセージはスキップ
    if (!content.trim()) {
      return
    }

    // ユーザーメッセージを作成
    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content: content.trim(),
      timestamp: Date.now(),
    }

    // ストアにユーザーメッセージを追加
    store.addMessage(userMessage)
    syncService.saveMessage(userMessage)

    // ローディング状態を開始
    store.setLoading(true)

    try {
      // 会話履歴を構築
      const history = this.buildConversationHistory()

      // LLMにメッセージを送信
      const structuredResponse = await measurePerformanceAsync(
        'LLM送信→レスポンス受信',
        () => llmClient.sendMessage(content.trim(), history, imageBase64)
      )

      // アシスタントメッセージを作成
      const assistantMessage: Message = {
        id: uuidv4(),
        role: 'assistant',
        content: structuredResponse.text ?? '',
        timestamp: Date.now(),
        motion: structuredResponse.motion,
        rawResponse: JSON.stringify(structuredResponse, null, 2),
        mapData: structuredResponse.mapData,
      }

      // ストアにアシスタントメッセージを追加
      store.addMessage(assistantMessage)
      syncService.saveMessage(assistantMessage)

      // TTS 自動再生（fire-and-forget）
      if (store.config.ui.ttsEnabled) {
        ttsService.synthesizeAndPlay(assistantMessage.content)
      }

      // メモリイベント保存（fire-and-forget）
      this.storeMemoryEvent(content.trim(), structuredResponse.text)

      // モーションと表情を再生
      await this.playMotionAndExpression(structuredResponse)

      // エラーをクリア
      store.setError(null)
    } catch (error) {
      // エラーハンドリング
      await this.handleError(error)
    } finally {
      // ローディング状態を終了
      store.setLoading(false)
    }
  }

  /**
   * モーションと表情を再生
   */
  private async playMotionAndExpression(response: StructuredResponse): Promise<void> {
    const store = useAppStore.getState()

    // モーションをキューに追加
    store.enqueueMotion(response.motion)

    // モーションを再生
    motionController.playMotion(response.motion)

    // 現在のモーションを更新
    store.setCurrentMotion(response.motion)

    // 感情に基づいて表情を設定（expressionVersion により同じ値でも再発火する）
    if (response.emotion) {
      const expressionName = this.emotionToExpression(response.emotion)
      console.log(`[ChatController] emotion=${response.emotion} → expression=${expressionName}`)
      store.setCurrentExpression(expressionName)
    }
  }

  /**
   * 感情を表情名に変換
   */
  private emotionToExpression(emotion: string): string {
    // mao_pro モデルの表情マッピング
    const emotionMap: Record<string, string> = {
      neutral: 'exp_01',
      happy: 'exp_02',
      thinking: 'exp_03',
      surprised: 'exp_04',
      sad: 'exp_05',
      embarrassed: 'exp_06',
      troubled: 'exp_07',
      angry: 'exp_08',
    }
    return emotionMap[emotion] || 'exp_01'
  }

  /**
   * 会話履歴を構築
   */
  private buildConversationHistory(): ConversationHistory {
    const store = useAppStore.getState()
    return {
      messages: store.messages,
      maxLength: 50, // 最大50メッセージまで保持
    }
  }

  /**
   * メモリイベントを AgentCore Memory に保存（fire-and-forget）
   */
  private storeMemoryEvent(userMessage: string, assistantMessage: string): void {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
    const accessToken = useAuthStore.getState().accessToken
    if (!apiBaseUrl || !accessToken) return

    fetch(`${apiBaseUrl}/memory/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: userMessage },
          { role: 'assistant', content: assistantMessage },
        ],
      }),
    }).catch((error) => {
      console.warn('[Memory] メモリイベント保存エラー:', error)
    })
  }

  /**
   * エラーを処理
   */
  private async handleError(error: unknown): Promise<void> {
    const store = useAppStore.getState()

    // エラーログを記録
    const errorLog = this.createErrorLog(error)
    console.error('[ChatController] Error:', errorLog)

    // ストアにエラーを設定（AppErrorの場合のみ）
    if (this.isAppError(error)) {
      store.setError(error)
    }

    // エラーに対応するモーションを再生
    const motionTag = this.getErrorMotion(error)
    store.enqueueMotion(motionTag)
    motionController.playMotion(motionTag)
    store.setCurrentMotion(motionTag)

    // エラーメッセージをアシスタントメッセージとして追加
    const errorMessage = this.getErrorMessage(error)
    const assistantMessage: Message = {
      id: uuidv4(),
      role: 'assistant',
      content: errorMessage,
      timestamp: Date.now(),
      motion: motionTag,
    }
    store.addMessage(assistantMessage)
    syncService.saveMessage(assistantMessage)

    // TTS 自動再生（fire-and-forget）
    if (store.config.ui.ttsEnabled) {
      ttsService.synthesizeAndPlay(assistantMessage.content)
    }
  }

  /**
   * エラーに対応するモーションを取得
   */
  private getErrorMotion(error: unknown): string {
    if (error instanceof NetworkError) {
      return ERROR_MOTIONS.network
    }
    if (error instanceof RateLimitError) {
      return ERROR_MOTIONS.rateLimit
    }
    if (error instanceof APIError) {
      return ERROR_MOTIONS.api
    }
    if (error instanceof ParseError) {
      return ERROR_MOTIONS.parse
    }
    return ERROR_MOTIONS.default
  }

  /**
   * エラーメッセージを取得
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof NetworkError) {
      return 'あれ、ネットがつながらないみたい…ネット接続を確認してみて！'
    }
    if (error instanceof RateLimitError) {
      return 'ごめんね、今ちょっと混み合ってるみたい。少し待ってからもう一回試してみて！'
    }
    if (error instanceof APIError) {
      return 'うーん、なんかうまくいかなかった…ちょっと時間をおいて試してみてね！'
    }
    if (error instanceof ParseError) {
      return 'あれ？うまく返事できなかった…もう一回聞いてくれる？'
    }
    if (error instanceof Error) {
      return `ごめん、なんかエラーが出ちゃった…：${error.message}`
    }
    return 'ごめんね、なんかうまくいかなかったみたい…もう一回試してみて！'
  }

  /**
   * エラーログを作成
   */
  private createErrorLog(error: unknown): Record<string, unknown> {
    const timestamp = new Date().toISOString()

    if (error instanceof Error) {
      return {
        timestamp,
        name: error.name,
        message: error.message,
        stack: error.stack,
        type: this.getErrorType(error),
      }
    }

    return {
      timestamp,
      error: String(error),
      type: 'unknown',
    }
  }

  /**
   * エラー種別を取得
   */
  private getErrorType(error: Error): string {
    if (error instanceof NetworkError) return 'network'
    if (error instanceof RateLimitError) return 'rateLimit'
    if (error instanceof APIError) return 'api'
    if (error instanceof ParseError) return 'parse'
    return 'unknown'
  }

  /**
   * AppErrorかどうかを判定
   */
  private isAppError(error: unknown): error is AppError {
    return (
      error instanceof NetworkError ||
      error instanceof APIError ||
      error instanceof RateLimitError ||
      error instanceof ParseError
    )
  }

  /**
   * 会話履歴をクリア
   */
  clearHistory(): void {
    const store = useAppStore.getState()
    store.clearMessages()
    // モーションを待機状態に戻す
    motionController.returnToIdle()
    store.setCurrentMotion('idle')
  }

  /**
   * 待機状態に戻る
   */
  returnToIdle(): void {
    const store = useAppStore.getState()
    motionController.returnToIdle()
    store.setCurrentMotion('idle')
  }
}

/**
 * Chat Controller のシングルトンインスタンス
 */
export const chatController = new ChatControllerImpl()

/**
 * テスト用にChatControllerImplクラスをエクスポート
 */
export { ChatControllerImpl }
