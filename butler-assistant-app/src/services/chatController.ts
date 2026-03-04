import { v4 as uuidv4 } from 'uuid'
import { llmClient } from './llmClient'
import { motionController } from './motionController'
import { syncService } from './syncService'
import { ttsService } from './ttsService'
import { useAppStore } from '@/stores/appStore'
import { useThemeStore } from '@/stores/themeStore'
import { getIdToken } from '@/auth'
import type { Message, StructuredResponse, AppError } from '@/types'
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
      // LLMにメッセージを送信（sessionId でサーバー側コンテキスト構築）
      const structuredResponse = await measurePerformanceAsync(
        'LLM送信→レスポンス受信',
        () => llmClient.sendMessage(content.trim(), store.sessionId, imageBase64, undefined, store.currentLocation ?? undefined)
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
        suggestedTheme: structuredResponse.suggestedTheme,
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
   * メモリイベントを AgentCore Memory に保存（fire-and-forget）
   */
  private async storeMemoryEvent(userMessage: string, assistantMessage: string): Promise<void> {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
    const accessToken = await getIdToken()
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
   * テーマセッションにメッセージを送信し、レスポンスを処理
   */
  async sendThemeMessage(content: string, themeId: string, imageBase64?: string): Promise<void> {
    const store = useThemeStore.getState()

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

    // ローディング状態を開始
    store.setSending(true)

    try {
      // LLMにメッセージを送信（themeId でテーマコンテキスト注入）
      const appStore = useAppStore.getState()
      const activeTheme = store.themes.find((t) => t.themeId === themeId)
      const themeModelKey = activeTheme?.modelKey
      const structuredResponse = await measurePerformanceAsync(
        'LLM送信→テーマレスポンス受信',
        () => llmClient.sendMessage(content.trim(), store.sessionId, imageBase64, themeId, appStore.currentLocation ?? undefined, themeModelKey)
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

      // トピック自動命名: レスポンスに themeName があれば store を更新
      if (structuredResponse.themeName) {
        store.updateThemeName(themeId, structuredResponse.themeName)
      }

      // ワーク（MCP）接続状態を更新
      if (structuredResponse.workStatus) {
        if (structuredResponse.workStatus.active) {
          store.setWorkConnection({
            themeId,
            active: true,
            expiresAt: structuredResponse.workStatus.expiresAt,
            tools: [], // ツール情報は初回接続時に取得済み
            serverUrl: '', // サーバーURLは初回接続時に取得済み
          })
        } else {
          store.clearWorkConnection()
        }
      }

      // ストアにアシスタントメッセージを追加
      store.addMessage(assistantMessage)

      // TTS 自動再生（fire-and-forget）
      if (appStore.config.ui.ttsEnabled) {
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
      await this.handleThemeError(error, store)
    } finally {
      // ローディング状態を終了
      store.setSending(false)
    }
  }

  /**
   * テーマセッションのエラーを処理
   */
  private async handleThemeError(error: unknown, store: { addMessage: (message: Message) => void; setError: (error: string | null) => void }): Promise<void> {
    console.error('[ChatController] Theme Error:', error)

    // エラーに対応するモーションを再生
    const motionTag = this.getErrorMotion(error)
    const appStore = useAppStore.getState()
    appStore.enqueueMotion(motionTag)
    motionController.playMotion(motionTag)
    appStore.setCurrentMotion(motionTag)

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

    // TTS 自動再生（fire-and-forget）
    if (appStore.config.ui.ttsEnabled) {
      ttsService.synthesizeAndPlay(assistantMessage.content)
    }
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
