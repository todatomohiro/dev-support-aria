/**
 * Web Speech API TTS サービス（ストリーミング TTS 対応）
 *
 * ブラウザ内蔵の SpeechSynthesis API を使用。API 呼び出し不要でレイテンシゼロ。
 * ストリーミング TTS: LLM 生成中に文が完成した時点で即座に utterance をキューに投入。
 * SpeechSynthesis が内部キューで順次再生する。
 */
class WebSpeechTtsServiceImpl {
  /** 再生キャンセルフラグ */
  private aborted = false
  /** 再生中フラグ */
  private _isSpeaking = false
  /** リップシンク用音量コールバック */
  private volumeCallback: ((volume: number) => void) | null = null
  /** ストリーミング TTS 監視タイマー */
  private streamingWatcherId: ReturnType<typeof setInterval> | null = null
  /** ストリーミング中に既に TTS 送信済みのテキスト長 */
  private streamingSentLength = 0
  /** ストリーミング TTS のキュー投入完了フラグ */
  private streamingEnqueueDone = false
  /** ストリーミング TTS 完了コールバック */
  private streamingResolve: (() => void) | null = null
  /** 現在キューに入っている utterance 数 */
  private pendingUtterances = 0
  /** 音量シミュレーション用 rAF ID */
  private animationFrameId: number | null = null
  /** 日本語音声キャッシュ */
  private cachedVoice: SpeechSynthesisVoice | null = null

  /** 音声再生中かどうかを返す */
  get isSpeaking(): boolean {
    return this._isSpeaking
  }

  /**
   * リップシンク用の音量コールバックを登録
   */
  setVolumeCallback(cb: ((volume: number) => void) | null): void {
    this.volumeCallback = cb
  }

  /**
   * iOS Safari 用 AudioContext アンロック（Web Speech API では不要だが互換性のため提供）
   */
  async unlockAudio(): Promise<void> {
    // Web Speech API はユーザージェスチャー不要（ただし一部ブラウザで初回に必要）
    // 空の utterance を再生してアンロック
    try {
      const utterance = new SpeechSynthesisUtterance('')
      utterance.volume = 0
      speechSynthesis.speak(utterance)
      speechSynthesis.cancel()
      console.log('[WebSpeech TTS] アンロック完了')
    } catch (e) {
      console.warn('[WebSpeech TTS] アンロック失敗:', e)
    }
  }

  /**
   * 日本語音声を取得（キャッシュあり）
   */
  private getJapaneseVoice(): SpeechSynthesisVoice | null {
    if (this.cachedVoice) return this.cachedVoice

    const voices = speechSynthesis.getVoices()
    // 優先順: ja-JP の女性声 → ja-JP の任意 → ja の任意
    const jaVoice =
      voices.find((v) => v.lang === 'ja-JP' && /female|kyoko|haruka|o-ren/i.test(v.name)) ??
      voices.find((v) => v.lang === 'ja-JP') ??
      voices.find((v) => v.lang.startsWith('ja'))

    if (jaVoice) {
      this.cachedVoice = jaVoice
      console.log(`[WebSpeech TTS] 音声選択: ${jaVoice.name} (${jaVoice.lang})`)
    }
    return jaVoice ?? null
  }

  /**
   * テキストから URL を除去する
   */
  private stripUrls(text: string): string {
    return text.replace(/https?:\/\/\S+/g, '').replace(/ {2,}/g, ' ').trim()
  }

  /**
   * テキストから Markdown 記法を除去する
   */
  private stripMarkdown(text: string): string {
    return text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/^\s*#{1,6}\s+/gm, '')
      .replace(/^\s*[-*]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/^\s*>\s+/gm, '')
      .replace(/\|[^|]*\|/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  }

  /**
   * テキストを浄化する（URL + Markdown 除去）
   */
  private cleanText(text: string): string {
    return this.stripMarkdown(this.stripUrls(text))
  }

  /**
   * 文末区切りで完了した文を抽出する
   */
  private extractCompleteSentences(text: string, sentLength: number): { sentences: string[]; newSentLength: number } {
    const remaining = text.slice(sentLength)
    if (!remaining) return { sentences: [], newSentLength: sentLength }

    const parts = remaining.split(/(?<=[。！？\n])/g)
    const sentences: string[] = []
    let consumed = 0

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim()
      if (!part) {
        consumed += parts[i].length
        continue
      }
      if (i === parts.length - 1 && !/[。！？\n]$/.test(parts[i])) {
        break
      }
      sentences.push(part)
      consumed += parts[i].length
    }

    return { sentences, newSentLength: sentLength + consumed }
  }

  /**
   * 単一テキストを SpeechSynthesis で発話し、完了まで待機
   */
  private speakText(text: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text)
      const voice = this.getJapaneseVoice()
      if (voice) {
        utterance.voice = voice
      }
      utterance.lang = 'ja-JP'
      utterance.rate = 1.1  // やや早めでテンポ良く
      utterance.pitch = 1.0

      this._isSpeaking = true
      this.startVolumeSimulation()

      utterance.onend = () => {
        this.pendingUtterances--
        if (this.pendingUtterances <= 0) {
          this.stopVolumeSimulation()
          this._isSpeaking = false
        }
        resolve()
      }
      utterance.onerror = (e) => {
        this.pendingUtterances--
        if (this.pendingUtterances <= 0) {
          this.stopVolumeSimulation()
          this._isSpeaking = false
        }
        console.warn('[WebSpeech TTS] 発話エラー:', e.error)
        resolve()
      }

      this.pendingUtterances++
      speechSynthesis.speak(utterance)
    })
  }

  /**
   * 音量シミュレーション（Web Speech API には音量データがないため疑似生成）
   */
  private startVolumeSimulation(): void {
    if (this.animationFrameId !== null || !this.volumeCallback) return

    let phase = 0
    const loop = () => {
      if (!this._isSpeaking) {
        this.volumeCallback?.(0)
        this.animationFrameId = null
        return
      }
      // 自然な口パク：ランダム + サイン波で 0.2〜0.8 の範囲
      phase += 0.15
      const volume = 0.3 + 0.3 * Math.sin(phase) + 0.2 * Math.random()
      this.volumeCallback?.(Math.min(1, Math.max(0, volume)))
      this.animationFrameId = requestAnimationFrame(loop)
    }
    this.animationFrameId = requestAnimationFrame(loop)
  }

  /**
   * 音量シミュレーションを停止
   */
  private stopVolumeSimulation(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
    this.volumeCallback?.(0)
  }

  /**
   * ストリーミング TTS を開始する
   *
   * streamingText を監視し、文が完成するたびに即座に SpeechSynthesis に投入。
   * ネットワーク通信なしのため、文検出から発話開始まで数ms。
   */
  async startStreamingTts(getStreamingText: () => string): Promise<void> {
    this.stop()
    this.aborted = false
    this.streamingSentLength = 0
    this.streamingEnqueueDone = false
    this.pendingUtterances = 0

    console.log('[WebSpeech TTS] ストリーミング TTS 開始')

    return new Promise<void>((resolve) => {
      this.streamingResolve = resolve

      // 150ms 間隔で streamingText を監視（Web Speech API はレイテンシゼロなのでより頻繁に）
      this.streamingWatcherId = setInterval(() => {
        if (this.aborted) {
          this.stopStreamingWatcher()
          resolve()
          return
        }

        const rawText = getStreamingText()
        if (!rawText) return

        const text = this.cleanText(rawText)
        const { sentences, newSentLength } = this.extractCompleteSentences(text, this.streamingSentLength)

        if (sentences.length > 0) {
          this.streamingSentLength = newSentLength
          for (const sentence of sentences) {
            if (sentence.length < 2) continue
            console.log(`[WebSpeech TTS] 文検出 → 即発話: "${sentence.slice(0, 30)}..."`)
            // fire-and-forget: SpeechSynthesis の内部キューに投入
            this.speakText(sentence)
          }
        }
      }, 150)

      // キュー完了を監視
      this.watchQueueCompletion()
    })
  }

  /**
   * すべての utterance が完了するのを監視
   */
  private watchQueueCompletion(): void {
    const check = setInterval(() => {
      if (this.aborted) {
        clearInterval(check)
        return
      }
      if (this.streamingEnqueueDone && this.pendingUtterances <= 0 && !speechSynthesis.speaking) {
        clearInterval(check)
        this._isSpeaking = false
        this.stopVolumeSimulation()
        if (this.streamingResolve) {
          this.streamingResolve()
          this.streamingResolve = null
        }
      }
    }, 100)
  }

  /**
   * ストリーミング TTS を終了する（残りのテキストを flush）
   */
  async finishStreamingTts(finalText: string): Promise<void> {
    this.stopStreamingWatcher()

    const text = this.cleanText(finalText)
    const remaining = text.slice(this.streamingSentLength).trim()

    if (remaining && remaining.length >= 2) {
      console.log(`[WebSpeech TTS] 残りテキスト → 発話: "${remaining.slice(0, 30)}..."`)
      this.speakText(remaining)
    }

    this.streamingEnqueueDone = true
  }

  /**
   * テキストを音声合成して再生（一括モード）
   */
  async synthesizeAndPlay(text: string): Promise<void> {
    this.stop()
    this.aborted = false

    const ttsText = this.cleanText(text)
    if (!ttsText) return

    // 文単位に分割して順次発話
    const sentences = ttsText.split(/(?<=[。！？\n])/g)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    for (const sentence of sentences) {
      if (this.aborted) break
      await this.speakText(sentence)
    }
  }

  /**
   * ストリーミング監視タイマーを停止
   */
  private stopStreamingWatcher(): void {
    if (this.streamingWatcherId !== null) {
      clearInterval(this.streamingWatcherId)
      this.streamingWatcherId = null
    }
  }

  /**
   * 現在の再生を停止
   */
  stop(): void {
    this.aborted = true
    this.stopStreamingWatcher()
    this.stopVolumeSimulation()
    speechSynthesis.cancel()
    this.pendingUtterances = 0
    this._isSpeaking = false
    this.streamingEnqueueDone = true
    if (this.streamingResolve) {
      this.streamingResolve()
      this.streamingResolve = null
    }
  }
}

/**
 * Web Speech TTS サービスのシングルトンインスタンス
 */
export const webSpeechTtsService = new WebSpeechTtsServiceImpl()
