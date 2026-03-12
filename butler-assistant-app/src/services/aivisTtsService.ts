import { getIdToken } from '@/auth'

/**
 * Aivis TTS サービス（ストリーミング TTS 対応）
 *
 * Lambda プロキシ経由で Aivis Cloud API を呼び出し、高品質な音声合成を行う。
 * ストリーミング TTS: LLM 生成中に文が完成した時点で即座に TTS 開始し、
 * AudioQueue で順次再生することで体感レスポンスを大幅に短縮する。
 * iOS Safari 対応のため AudioContext + AudioBufferSourceNode で再生。
 */
class AivisTtsServiceImpl {
  /** Web Audio コンテキスト（iOS 対応のため共有） */
  private audioContext: AudioContext | null = null
  /** 現在再生中の AudioBufferSourceNode */
  private currentSource: AudioBufferSourceNode | null = null
  /** 再生開始時刻（AudioContext.currentTime ベース） */
  private playbackStartTime = 0
  /** 事前計算済み音量エンベロープ（60fps 間隔） */
  private volumeEnvelope: Float32Array | null = null
  /** rAF ループ ID */
  private animationFrameId: number | null = null
  /** リップシンク用音量コールバック */
  private volumeCallback: ((volume: number) => void) | null = null
  /** 再生キャンセルフラグ */
  private aborted = false
  /** 再生中フラグ */
  private _isSpeaking = false

  /** オーディオキュー（合成済み音声を順次再生） */
  private audioQueue: Uint8Array[] = []
  /** キュー再生中フラグ */
  private isPlayingQueue = false
  /** ストリーミング TTS 監視タイマー */
  private streamingWatcherId: ReturnType<typeof setInterval> | null = null
  /** ストリーミング中に既に TTS 送信済みのテキスト長 */
  private streamingSentLength = 0
  /** ストリーミング TTS 完了コールバック（chat_complete 後に呼ばれる） */
  private streamingResolve: (() => void) | null = null
  /** ストリーミング TTS のキュー投入完了フラグ */
  private streamingEnqueueDone = false

  private static readonly ENVELOPE_FPS = 60

  /** 音声再生中かどうかを返す */
  get isSpeaking(): boolean {
    return this._isSpeaking
  }

  /**
   * iOS Safari のオーディオ自動再生制限を解除
   */
  async unlockAudio(): Promise<void> {
    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext()
      }
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume()
      }
      const silentBuffer = this.audioContext.createBuffer(1, 1, this.audioContext.sampleRate)
      const source = this.audioContext.createBufferSource()
      source.buffer = silentBuffer
      source.connect(this.audioContext.destination)
      source.start()
      console.log('[Aivis TTS] AudioContext アンロック完了:', this.audioContext.state)
    } catch (e) {
      console.warn('[Aivis TTS] AudioContext アンロック失敗:', e)
    }
  }

  /**
   * リップシンク用の音量コールバックを登録
   */
  setVolumeCallback(cb: ((volume: number) => void) | null): void {
    this.volumeCallback = cb
  }

  /**
   * テキストから URL を除去する（TTS 読み上げ用）
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
   * 文末区切りで完了した文を抽出する
   *
   * streamingText を監視し、文末（。！？\n）で区切られた完成文を返す。
   * まだ文末に達していない部分は次回に持ち越す。
   */
  private extractCompleteSentences(text: string, sentLength: number): { sentences: string[]; newSentLength: number } {
    const remaining = text.slice(sentLength)
    if (!remaining) return { sentences: [], newSentLength: sentLength }

    // 文末パターンで分割（区切り文字を保持）
    const parts = remaining.split(/(?<=[。！？\n])/g)

    // 最後のパーツが文末で終わっていない場合は未完成 → 保留
    const sentences: string[] = []
    let consumed = 0
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim()
      if (!part) {
        consumed += parts[i].length
        continue
      }

      // 最後のパーツが文末で終わっていなければ保留
      if (i === parts.length - 1 && !/[。！？\n]$/.test(parts[i])) {
        break
      }

      sentences.push(part)
      consumed += parts[i].length
    }

    return { sentences, newSentLength: sentLength + consumed }
  }

  /**
   * 単一チャンクの Aivis TTS 合成（Lambda プロキシ経由）
   */
  private async synthesizeChunk(text: string, apiBaseUrl: string, accessToken: string): Promise<Uint8Array | null> {
    try {
      const res = await fetch(`${apiBaseUrl}/tts/synthesize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ text, provider: 'aivis' }),
      })

      if (!res.ok) {
        console.warn(`[Aivis TTS] API エラー: ${res.status}`)
        return null
      }

      const data = await res.json()
      const binary = atob(data.audio)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      return bytes
    } catch (e) {
      console.warn('[Aivis TTS] 合成エラー:', e)
      return null
    }
  }

  /**
   * AudioContext を確保
   */
  private async ensureAudioContext(): Promise<AudioContext> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext()
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume()
    }
    return this.audioContext
  }

  /**
   * 音声バイナリを AudioContext 経由で再生し、完了まで待機
   */
  private async playAudioBytes(bytes: Uint8Array): Promise<void> {
    const ctx = await this.ensureAudioContext()

    const copied = new Uint8Array(bytes).buffer
    const audioBuffer = await ctx.decodeAudioData(copied)

    this.computeVolumeEnvelopeFromBuffer(audioBuffer)

    const source = ctx.createBufferSource()
    source.buffer = audioBuffer
    source.connect(ctx.destination)

    this.currentSource = source
    this._isSpeaking = true
    this.playbackStartTime = ctx.currentTime
    source.start()
    this.startVolumeLoop()

    await new Promise<void>((resolve) => {
      source.onended = () => {
        this.stopVolumeLoop()
        this.currentSource = null
        resolve()
      }
    })
  }

  /**
   * オーディオキューを順次再生するループ
   */
  private async processAudioQueue(): Promise<void> {
    if (this.isPlayingQueue) return
    this.isPlayingQueue = true

    while (this.audioQueue.length > 0 || !this.streamingEnqueueDone) {
      if (this.aborted) break

      const bytes = this.audioQueue.shift()
      if (bytes) {
        await this.playAudioBytes(bytes)
      } else {
        // キューが空だが、まだ追加される可能性がある → 少し待つ
        await new Promise((r) => setTimeout(r, 100))
      }
    }

    this.isPlayingQueue = false
    this._isSpeaking = false

    // すべて再生完了 → resolve
    if (this.streamingResolve) {
      this.streamingResolve()
      this.streamingResolve = null
    }
  }

  /**
   * ストリーミング TTS を開始する
   *
   * appStore.streamingText を監視し、文が完成するたびに TTS 合成をキューに投入。
   * LLM 応答が chat_complete で確定した後に finishStreamingTts() を呼ぶ。
   *
   * @returns 全再生が完了したら resolve する Promise
   */
  async startStreamingTts(getStreamingText: () => string): Promise<void> {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
    if (!apiBaseUrl) {
      throw new Error('[Aivis TTS] VITE_API_BASE_URL が未設定です')
    }

    const accessToken = await getIdToken()
    if (!accessToken) {
      throw new Error('[Aivis TTS] 認証トークンがありません')
    }

    this.stop()
    this.aborted = false
    this.audioQueue = []
    this.isPlayingQueue = false
    this.streamingSentLength = 0
    this.streamingEnqueueDone = false

    console.log('[Aivis TTS] ストリーミング TTS 開始')

    return new Promise<void>((resolve) => {
      this.streamingResolve = resolve

      // 200ms 間隔で streamingText を監視
      this.streamingWatcherId = setInterval(() => {
        if (this.aborted) {
          this.stopStreamingWatcher()
          resolve()
          return
        }

        const rawText = getStreamingText()
        if (!rawText) return

        const text = this.stripMarkdown(this.stripUrls(rawText))
        const { sentences, newSentLength } = this.extractCompleteSentences(text, this.streamingSentLength)

        if (sentences.length > 0) {
          this.streamingSentLength = newSentLength
          for (const sentence of sentences) {
            if (sentence.length < 2) continue // 極短文はスキップ
            console.log(`[Aivis TTS] 文検出 → TTS キュー投入: "${sentence.slice(0, 30)}..."`)
            this.enqueueSynthesis(sentence, apiBaseUrl, accessToken)
          }
        }
      }, 200)

      // キュー再生を開始
      this.processAudioQueue()
    })
  }

  /**
   * ストリーミング TTS を終了する（残りのテキストを flush）
   *
   * chat_complete 後に呼ばれ、未送信の残りテキストを TTS に投入して
   * キューへの追加を完了する。
   */
  async finishStreamingTts(finalText: string): Promise<void> {
    this.stopStreamingWatcher()

    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
    const accessToken = await getIdToken()
    if (!apiBaseUrl || !accessToken) {
      this.streamingEnqueueDone = true
      return
    }

    const text = this.stripMarkdown(this.stripUrls(finalText))
    const remaining = text.slice(this.streamingSentLength).trim()

    if (remaining && remaining.length >= 2) {
      console.log(`[Aivis TTS] 残りテキスト → TTS キュー投入: "${remaining.slice(0, 30)}..."`)
      this.enqueueSynthesis(remaining, apiBaseUrl, accessToken)
    }

    this.streamingEnqueueDone = true
  }

  /**
   * テキストを非同期で合成し、結果をオーディオキューに追加
   */
  private enqueueSynthesis(text: string, apiBaseUrl: string, accessToken: string): void {
    this.synthesizeChunk(text, apiBaseUrl, accessToken).then((bytes) => {
      if (bytes && !this.aborted) {
        this.audioQueue.push(bytes)
      }
    })
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
   * テキストを音声合成して再生（一括モード: チャンク並列取得 + 順次再生）
   *
   * ストリーミング TTS が使えない場合のフォールバック。
   */
  async synthesizeAndPlay(text: string): Promise<void> {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
    if (!apiBaseUrl) {
      throw new Error('[Aivis TTS] VITE_API_BASE_URL が未設定です')
    }

    const accessToken = await getIdToken()
    if (!accessToken) {
      throw new Error('[Aivis TTS] 認証トークンがありません')
    }

    const ttsText = this.stripMarkdown(this.stripUrls(text))
    if (!ttsText) return

    this.stop()
    this.aborted = false

    // 文単位に分割
    const chunks = this.splitIntoChunks(ttsText)
    console.log(`[Aivis TTS] チャンク分割: ${chunks.length} 件`)

    if (chunks.length <= 1) {
      const bytes = await this.synthesizeChunk(ttsText, apiBaseUrl, accessToken)
      if (this.aborted) return
      if (!bytes) {
        throw new Error('[Aivis TTS] 音声合成に失敗しました')
      }
      await this.playAudioBytes(bytes)
      this._isSpeaking = false
      return
    }

    const firstPromise = this.synthesizeChunk(chunks[0], apiBaseUrl, accessToken)
    const restPromises = chunks.slice(1).map((chunk) =>
      this.synthesizeChunk(chunk, apiBaseUrl, accessToken)
    )

    const firstBytes = await firstPromise
    if (this.aborted) return
    if (!firstBytes) {
      throw new Error('[Aivis TTS] 先行チャンクの音声合成に失敗しました')
    }

    await this.playAudioBytes(firstBytes)

    const restResults = await Promise.all(restPromises)
    for (const bytes of restResults) {
      if (this.aborted) break
      if (!bytes) continue
      await this.playAudioBytes(bytes)
    }
    this._isSpeaking = false
  }

  /**
   * テキストを文単位のチャンクに分割
   */
  private splitIntoChunks(text: string): string[] {
    const raw = text.split(/(?<=[。！？\n])/g)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    if (raw.length === 0) return [text]

    const chunks: string[] = []
    let buffer = ''
    for (const segment of raw) {
      buffer += segment
      if (buffer.length >= 10) {
        chunks.push(buffer)
        buffer = ''
      }
    }
    if (buffer) {
      if (chunks.length > 0) {
        chunks[chunks.length - 1] += buffer
      } else {
        chunks.push(buffer)
      }
    }

    return chunks
  }

  /**
   * AudioBuffer から音量エンベロープを計算
   */
  private computeVolumeEnvelopeFromBuffer(audioBuffer: AudioBuffer): void {
    try {
      const channelData = audioBuffer.getChannelData(0)
      const sampleRate = audioBuffer.sampleRate
      const samplesPerFrame = Math.floor(sampleRate / AivisTtsServiceImpl.ENVELOPE_FPS)
      const frameCount = Math.ceil(channelData.length / samplesPerFrame)
      const envelope = new Float32Array(frameCount)

      for (let i = 0; i < frameCount; i++) {
        const start = i * samplesPerFrame
        const end = Math.min(start + samplesPerFrame, channelData.length)
        let sum = 0
        for (let j = start; j < end; j++) {
          sum += channelData[j] * channelData[j]
        }
        const rms = Math.sqrt(sum / (end - start))
        envelope[i] = Math.min(1, rms * 4)
      }

      this.volumeEnvelope = envelope
    } catch (e) {
      console.warn('[Aivis TTS] 音量エンベロープの計算に失敗:', e)
      this.volumeEnvelope = null
    }
  }

  /**
   * rAF ループで音量を通知
   */
  private startVolumeLoop(): void {
    if (!this.volumeEnvelope || !this.volumeCallback || !this.audioContext) return

    const envelope = this.volumeEnvelope
    const fps = AivisTtsServiceImpl.ENVELOPE_FPS
    const ctx = this.audioContext
    const startTime = this.playbackStartTime

    const loop = () => {
      const elapsed = ctx.currentTime - startTime
      const frameIndex = Math.floor(elapsed * fps)
      const volume = frameIndex < envelope.length ? envelope[frameIndex] : 0
      this.volumeCallback?.(volume)
      this.animationFrameId = requestAnimationFrame(loop)
    }

    this.animationFrameId = requestAnimationFrame(loop)
  }

  /**
   * 音量通知ループを停止
   */
  private stopVolumeLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
    this.volumeCallback?.(0)
  }

  /**
   * 現在の再生を停止
   */
  stop(): void {
    this.aborted = true
    this.stopStreamingWatcher()
    this.stopVolumeLoop()
    this.audioQueue = []
    this.streamingEnqueueDone = true
    if (this.currentSource) {
      try {
        this.currentSource.stop()
      } catch {
        // 既に停止済み
      }
    }
    this.currentSource = null
    this.volumeEnvelope = null
    this._isSpeaking = false
    this.isPlayingQueue = false
    if (this.streamingResolve) {
      this.streamingResolve()
      this.streamingResolve = null
    }
  }
}

/**
 * Aivis TTS サービスのシングルトンインスタンス
 */
export const aivisTtsService = new AivisTtsServiceImpl()
