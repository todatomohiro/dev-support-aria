import { v4 as uuidv4 } from 'uuid'
import { llmClient } from './llmClient'
import { motionController } from './motionController'
import { syncService } from './syncService'
import { ttsService } from './ttsService'
import { wsService } from './wsService'
import type { ChatStreamEvent } from './wsService'
import { useAppStore } from '@/stores/appStore'
import { useThemeStore } from '@/stores/themeStore'
import { getIdToken } from '@/auth'
import type { Message, StructuredResponse, AppError } from '@/types'
import type { EmotionType } from '@/types/response'
import { NetworkError, APIError, RateLimitError, ParseError } from '@/types'
import { measurePerformanceAsync } from '@/utils/performance'

/**
 * ストリーミング中の累積テキストから表示用テキストを抽出
 *
 * LLM の出力パターン:
 *   パターンA: 平文テキスト（JSON なし、または JSON が後ろに来る）
 *   パターンB: {"text": "...", "emotion": "...", ...} の JSON 形式
 *
 * 平文テキスト部分のみを抽出し、JSON メタデータ部分は除外する。
 */
function extractStreamingText(raw: string): string {
  // 先頭が `{` で始まる場合は JSON 形式 → "text" フィールドを抽出
  if (raw.trimStart().startsWith('{')) {
    const textFieldMatch = raw.match(/"text"\s*:\s*"/)
    if (textFieldMatch && textFieldMatch.index !== undefined) {
      const valueStart = textFieldMatch.index + textFieldMatch[0].length
      const rest = raw.slice(valueStart)
      let result = ''
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '\\' && i + 1 < rest.length) {
          const next = rest[i + 1]
          if (next === 'n') { result += '\n'; i++; continue }
          if (next === '"') { result += '"'; i++; continue }
          if (next === '\\') { result += '\\'; i++; continue }
          result += next; i++; continue
        }
        if (rest[i] === '"') break
        result += rest[i]
      }
      return result
    }
    return ''
  }

  // 平文モード: 最初の JSON オブジェクト以降をすべて除外
  // LLM は平文 → {"emotion":...} や {\n  "emotion":...} の順で出力する場合がある
  const firstJsonIndex = raw.search(/\{[\s]*"/)
  if (firstJsonIndex > 0) {
    return raw.slice(0, firstJsonIndex).trim()
  }

  // 完全に平文のみ（JSON なし）
  return raw.trim()
}

/**
 * ブレース対応で文字列中のトップレベル JSON オブジェクトを抽出
 *
 * 正規表現では深いネスト（mapData 等）に対応できないため、
 * ブレースのネスト深度を追跡して完全な JSON オブジェクトを切り出す。
 * 文字列リテラル内のブレースはスキップする。
 */
function findJsonObjects(raw: string): string[] {
  const results: string[] = []
  let i = 0
  while (i < raw.length) {
    if (raw[i] === '{') {
      let depth = 0
      let inString = false
      let escape = false
      const start = i
      for (let j = i; j < raw.length; j++) {
        const ch = raw[j]
        if (escape) { escape = false; continue }
        if (ch === '\\' && inString) { escape = true; continue }
        if (ch === '"' && !escape) { inString = !inString; continue }
        if (inString) continue
        if (ch === '{') depth++
        if (ch === '}') {
          depth--
          if (depth === 0) {
            results.push(raw.slice(start, j + 1))
            i = j + 1
            break
          }
        }
        if (j === raw.length - 1) {
          // 閉じブレースなし（不完全な JSON）→ スキップ
          i = j + 1
        }
      }
    } else {
      i++
    }
  }
  return results
}

/**
 * エラー種別に対応するモーションタグ
 */
const ERROR_MOTIONS: Record<string, string> = {
  network: 'troubled',
  api: 'troubled',
  rateLimit: 'sad',
  parse: 'surprised',
  default: 'troubled',
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
      ...(imageBase64 ? { imageBase64 } : {}),
    }

    // ストアにユーザーメッセージを追加
    store.addMessage(userMessage)
    syncService.saveMessage(userMessage)

    // ローディング状態を開始
    store.setLoading(true)

    // ブリーフィングコンテキストを取得してクリア（初回送信時のみ）
    const briefingContext = store.lastBriefingContext
    if (briefingContext) {
      store.setLastBriefingContext(null)
    }

    // WebSocket 接続中ならストリーミングモードを使用
    const useStreaming = wsService.isConnected()
    if (useStreaming) {
      try {
        await this.sendMessageStreaming(content.trim(), imageBase64, briefingContext ?? undefined)
      } catch (error) {
        await this.handleError(error)
      } finally {
        store.setLoading(false)
      }
      return
    }

    try {
      // LLMにメッセージを送信（sessionId でサーバー側コンテキスト構築）
      const structuredResponse = await measurePerformanceAsync(
        'LLM送信→レスポンス受信',
        () => llmClient.sendMessage(content.trim(), store.sessionId, imageBase64, undefined, store.currentLocation ?? undefined, undefined, store.config.ui.developerMode, undefined, briefingContext ?? undefined)
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
        suggestedReplies: structuredResponse.suggestedReplies,
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
      this.playExpression(structuredResponse)

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
   * ストリーミングモードでメッセージを送信
   * REST で送信し、WebSocket 経由でリアルタイムにテキストを受信
   */
  private async sendMessageStreaming(content: string, imageBase64?: string, briefingContext?: string): Promise<void> {
    const store = useAppStore.getState()

    // ストリーミング状態を初期化
    store.setStreamingRequestId('pending')
    store.setStreamingText('')

    return new Promise<void>((resolve, reject) => {
      let completed = false
      let rawAccumulated = ''

      // WebSocket コールバックを登録
      const handleStreamEvent = (event: ChatStreamEvent) => {

        switch (event.type) {
          case 'chat_delta': {
            rawAccumulated += event.delta
            const displayText = extractStreamingText(rawAccumulated)
            useAppStore.getState().setStreamingText(displayText)
            break
          }

          case 'chat_tool_start':
            console.log(`[Streaming] ツール実行中: ${event.tool}`)
            break

          case 'chat_tool_result':
            console.log(`[Streaming] ツール結果: ${event.tool}`)
            break

          case 'chat_complete': {
            completed = true
            wsService.onChatStream(null)

            // ストリーミング状態をクリア
            const finalStore = useAppStore.getState()
            finalStore.setStreamingText(null)
            finalStore.setStreamingRequestId(null)

            // chat_complete の content は raw LLM JSON → パースして構造化
            const structuredResponse = this.parseStreamedContent(
              event.content ?? rawAccumulated,
              event,
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
              suggestedReplies: structuredResponse.suggestedReplies,
            }

            finalStore.addMessage(assistantMessage)
            syncService.saveMessage(assistantMessage)

            // TTS 自動再生
            if (finalStore.config.ui.ttsEnabled) {
              ttsService.synthesizeAndPlay(assistantMessage.content)
            }

            // メモリイベント保存
            this.storeMemoryEvent(content, structuredResponse.text)

            // モーションと表情を再生
            this.playExpression(structuredResponse)

            finalStore.setError(null)
            finalStore.setLoading(false)
            resolve()
            break
          }

          case 'chat_error':
            completed = true
            wsService.onChatStream(null)
            useAppStore.getState().setStreamingText(null)
            useAppStore.getState().setStreamingRequestId(null)
            reject(new APIError(event.error, 500))
            break
        }
      }

      wsService.onChatStream(handleStreamEvent)

      // REST リクエストを送信（streaming: true）
      llmClient.sendMessage(content, store.sessionId, imageBase64, undefined, store.currentLocation ?? undefined, undefined, store.config.ui.developerMode, true, briefingContext)
        .catch((error) => {
          // REST エラー（タイムアウト含む）: ストリーミングが完了していなければエラー
          if (!completed) {
            wsService.onChatStream(null)
            useAppStore.getState().setStreamingText(null)
            useAppStore.getState().setStreamingRequestId(null)
            reject(error)
          }
        })
    })
  }

  /**
   * ストリーミング完了時の raw content をパースして StructuredResponse を生成
   */
  private parseStreamedContent(rawContent: string, event: ChatStreamEvent & { type: 'chat_complete' }): StructuredResponse {
    // テキスト部分は常に extractStreamingText で JSON を確実に除去
    let text = extractStreamingText(rawContent)
    let emotion: EmotionType = 'neutral'
    let motion = 'idle'
    let mapData: StructuredResponse['mapData'] = undefined
    let suggestedTheme: StructuredResponse['suggestedTheme'] = undefined
    let suggestedReplies: StructuredResponse['suggestedReplies'] = undefined

    try {
      // ブレース対応で JSON オブジェクトを抽出（深いネストにも対応）
      const jsonObjects = findJsonObjects(rawContent)

      // 後ろから探して "text" フィールドを含む JSON を優先
      let parsed: Record<string, unknown> | null = null
      for (let i = jsonObjects.length - 1; i >= 0; i--) {
        try {
          const candidate = JSON.parse(jsonObjects[i])
          if (candidate.text) {
            parsed = candidate
            break
          }
          if (!parsed) parsed = candidate
        } catch {
          // パース失敗は無視して次の候補へ
        }
      }

      if (parsed) {
        if (parsed.text) text = parsed.text as string
        if (parsed.emotion) emotion = parsed.emotion as EmotionType
        if (parsed.motion) motion = parsed.motion as string
        if (parsed.mapData) mapData = parsed.mapData as StructuredResponse['mapData']
        if (parsed.suggestedTheme) suggestedTheme = parsed.suggestedTheme as StructuredResponse['suggestedTheme']
        if (parsed.suggestedReplies) suggestedReplies = parsed.suggestedReplies as StructuredResponse['suggestedReplies']
      }
    } catch {
      console.warn('[Streaming] レスポンスJSONのパースに失敗、テキストをそのまま使用')
    }

    return {
      text,
      emotion,
      motion,
      mapData,
      suggestedTheme,
      suggestedReplies,
      themeName: event.themeName as string | undefined,
      workStatus: event.workStatus as StructuredResponse['workStatus'],
      enhancedSystemPrompt: event.enhancedSystemPrompt as string | undefined,
    }
  }

  /**
   * 感情・モーションに基づいて表情とモーションを再生
   */
  private playExpression(response: StructuredResponse): void {
    const store = useAppStore.getState()

    // 表情（emotion）を再生
    if (response.emotion) {
      const expressionName = this.emotionToExpression(response.emotion)
      console.log(`[ChatController] emotion=${response.emotion} → expression=${expressionName}`)
      store.setCurrentExpression(expressionName)
    }

    // モーション（motion）を再生（LLM が指定した場合のみ）
    if (response.motion && response.motion !== 'idle') {
      console.log(`[ChatController] motion=${response.motion}`)
      store.setCurrentMotion(response.motion)
    }
  }

  /**
   * 感情を表情名に変換
   *
   * サーバーから取得したモデルメタデータの emotionMapping を優先し、
   * なければデフォルトの mao_pro マッピングにフォールバック。
   */
  private emotionToExpression(emotion: string): string {
    // サーバーから取得したマッピングを優先（空文字=未設定は無視）
    const meta = useAppStore.getState().activeModelMeta
    if (meta?.emotionMapping) {
      const mapped = meta.emotionMapping[emotion]
      if (mapped) return mapped
      const neutralFallback = meta.emotionMapping['neutral']
      if (neutralFallback) return neutralFallback
    }

    // デフォルト: mao_pro モデルの表情マッピング
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
   *
   * プライベートモードの場合は isPrivate フラグを付与し、バックエンドで保存をスキップさせる。
   */
  private async storeMemoryEvent(userMessage: string, assistantMessage: string, isPrivate = false): Promise<void> {
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
        ...(isPrivate ? { isPrivate: true } : {}),
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
      ...(imageBase64 ? { imageBase64 } : {}),
    }

    // ストアにユーザーメッセージを追加
    store.addMessage(userMessage)

    // ローディング状態を開始
    store.setSending(true)

    // WebSocket 接続中ならストリーミングモードを使用
    const useStreaming = wsService.isConnected()

    if (useStreaming) {
      try {
        await this.sendThemeMessageStreaming(content.trim(), themeId, imageBase64)
      } catch (error) {
        await this.handleThemeError(error, store)
      } finally {
        store.setSending(false)
      }
      return
    }

    try {
      // LLMにメッセージを送信（themeId でテーマコンテキスト注入）
      const appStore = useAppStore.getState()
      const activeTheme = store.themes.find((t) => t.themeId === themeId)
      const themeModelKey = activeTheme?.modelKey
      const structuredResponse = await measurePerformanceAsync(
        'LLM送信→テーマレスポンス受信',
        () => llmClient.sendMessage(content.trim(), store.sessionId, imageBase64, themeId, appStore.currentLocation ?? undefined, themeModelKey, appStore.config.ui.developerMode)
      )

      this.processThemeResponse(structuredResponse, content.trim(), themeId, store, activeTheme?.isPrivate)
    } catch (error) {
      // エラーハンドリング
      await this.handleThemeError(error, store)
    } finally {
      // ローディング状態を終了
      store.setSending(false)
    }
  }

  /**
   * テーマメッセージのストリーミング送信
   */
  private async sendThemeMessageStreaming(content: string, themeId: string, imageBase64?: string): Promise<void> {
    const appStore = useAppStore.getState()
    const store = useThemeStore.getState()
    const activeTheme = store.themes.find((t) => t.themeId === themeId)
    const themeModelKey = activeTheme?.modelKey

    // ストリーミング状態を初期化
    appStore.setStreamingRequestId('pending')
    appStore.setStreamingText('')

    return new Promise<void>((resolve, reject) => {
      let completed = false
      let rawAccumulated = ''

      const handleStreamEvent = (event: ChatStreamEvent) => {
        switch (event.type) {
          case 'chat_delta': {
            rawAccumulated += event.delta
            const displayText = extractStreamingText(rawAccumulated)
            useAppStore.getState().setStreamingText(displayText)
            break
          }

          case 'chat_tool_start':
            console.log(`[Streaming] ツール実行中: ${event.tool}`)
            break

          case 'chat_tool_result':
            console.log(`[Streaming] ツール結果: ${event.tool}`)
            break

          case 'chat_complete': {
            completed = true
            wsService.onChatStream(null)

            const finalAppStore = useAppStore.getState()
            finalAppStore.setStreamingText(null)
            finalAppStore.setStreamingRequestId(null)

            const structuredResponse = this.parseStreamedContent(
              event.content ?? rawAccumulated,
              event,
            )

            this.processThemeResponse(structuredResponse, content, themeId, useThemeStore.getState(), activeTheme?.isPrivate)

            finalAppStore.setLoading(false)
            resolve()
            break
          }

          case 'chat_error':
            completed = true
            wsService.onChatStream(null)
            useAppStore.getState().setStreamingText(null)
            useAppStore.getState().setStreamingRequestId(null)
            reject(new APIError(event.error, 500))
            break
        }
      }

      wsService.onChatStream(handleStreamEvent)

      llmClient.sendMessage(content, store.sessionId, imageBase64, themeId, appStore.currentLocation ?? undefined, themeModelKey, appStore.config.ui.developerMode, true)
        .catch((error) => {
          if (!completed) {
            wsService.onChatStream(null)
            useAppStore.getState().setStreamingText(null)
            useAppStore.getState().setStreamingRequestId(null)
            reject(error)
          }
        })
    })
  }

  /**
   * テーマレスポンスの共通処理（ストリーミング・非ストリーミング共用）
   */
  private processThemeResponse(structuredResponse: StructuredResponse, content: string, themeId: string, store: ReturnType<typeof useThemeStore.getState>, isPrivate = false): void {
    const appStore = useAppStore.getState()

    // アシスタントメッセージを作成
    const assistantMessage: Message = {
      id: uuidv4(),
      role: 'assistant',
      content: structuredResponse.text ?? '',
      timestamp: Date.now(),
      motion: structuredResponse.motion,
      rawResponse: JSON.stringify(structuredResponse, null, 2),
      mapData: structuredResponse.mapData,
      suggestedReplies: structuredResponse.suggestedReplies,
    }

    // トピック自動命名
    if (structuredResponse.themeName) {
      store.updateThemeName(themeId, structuredResponse.themeName)
    }

    // ワーク（MCP）接続状態を更新
    if (structuredResponse.workStatus) {
      if (structuredResponse.workStatus.active) {
        const existing = store.activeWorkConnection
        store.setWorkConnection({
          ...existing,
          themeId,
          active: true,
          expiresAt: structuredResponse.workStatus.expiresAt,
          tools: existing?.tools ?? [],
          serverUrl: existing?.serverUrl ?? '',
        })
      } else {
        store.clearWorkConnection()
      }
    }

    store.addMessage(assistantMessage)

    if (appStore.config.ui.ttsEnabled) {
      ttsService.synthesizeAndPlay(assistantMessage.content)
    }

    this.storeMemoryEvent(content, structuredResponse.text, isPrivate)
    this.playExpression(structuredResponse)
    store.setError(null)
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
   * プロアクティブ・ブリーフィングを要求
   * ユーザーメッセージは表示せず、AIからの自発的な発言として処理する
   */
  async requestBriefing(userLocation?: { lat: number; lng: number }): Promise<void> {
    const store = useAppStore.getState()

    // ローディング中は実行しない
    if (store.isLoading) return

    store.setLoading(true)

    try {
      const structuredResponse = await llmClient.sendMessage(
        '__briefing__',
        store.sessionId,
        undefined,
        undefined,
        userLocation,
        undefined,
        false
      )

      // アシスタントメッセージを作成（ユーザーメッセージは追加しない）
      const assistantMessage: Message = {
        id: uuidv4(),
        role: 'assistant',
        content: structuredResponse.text ?? '',
        timestamp: Date.now(),
        motion: structuredResponse.motion,
        suggestedReplies: structuredResponse.suggestedReplies,
      }

      store.addMessage(assistantMessage)
      syncService.saveMessage(assistantMessage)

      // ブリーフィング発言をコンテキストとして保持（次の初回送信時に引き継ぐ）
      if (assistantMessage.content) {
        store.setLastBriefingContext(assistantMessage.content)
      }

      // TTS 自動再生
      if (store.config.ui.ttsEnabled) {
        ttsService.synthesizeAndPlay(assistantMessage.content)
      }

      // モーションと表情を再生
      this.playExpression(structuredResponse)

      store.setError(null)
    } catch (error) {
      // ブリーフィング失敗は静かに無視（ユーザー操作ではないため）
      console.warn('[ChatController] ブリーフィング取得エラー:', error)
    } finally {
      store.setLoading(false)
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
