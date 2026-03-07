import { getIdToken } from '@/auth'

/**
 * TTS サービス
 * Amazon Polly API を呼び出してアシスタント返信を音声再生する
 * 音声データを事前デコードして音量エンベロープを計算しリップシンクに利用
 *
 * Phase 2: テキストを文単位に分割し、最初の文を先行 TTS → 残りを並列取得 → AudioQueue で順次再生
 */
class TtsServiceImpl {
  /** 現在再生中の Audio インスタンス */
  private currentAudio: HTMLAudioElement | null = null
  /** 現在の Object URL（メモリリーク防止用） */
  private currentUrl: string | null = null
  /** Web Audio コンテキスト（遅延生成） */
  private audioContext: AudioContext | null = null
  /** 事前計算済み音量エンベロープ（60fps 間隔） */
  private volumeEnvelope: Float32Array | null = null
  /** rAF ループ ID */
  private animationFrameId: number | null = null
  /** リップシンク用音量コールバック */
  private volumeCallback: ((volume: number) => void) | null = null
  /** 再生キャンセルフラグ */
  private aborted = false

  /** 音量エンベロープの FPS */
  private static readonly ENVELOPE_FPS = 60

  /** 音声再生中かどうかを返す */
  get isSpeaking(): boolean {
    return this.currentAudio !== null && !this.currentAudio.paused
  }

  /**
   * リップシンク用の音量コールバックを登録
   * TTS 再生中にフレームごとの音量（0〜1）が通知される
   */
  setVolumeCallback(cb: ((volume: number) => void) | null): void {
    this.volumeCallback = cb
  }

  /**
   * テキストから URL を除去する（TTS 読み上げ用）
   * 連続スペースも1つに圧縮する
   */
  private stripUrls(text: string): string {
    return text.replace(/https?:\/\/\S+/g, '').replace(/ {2,}/g, ' ').trim()
  }

  /**
   * テキストを文単位のチャンクに分割
   *
   * 句読点（。！？\n）で区切り、短すぎるチャンクは次と結合する。
   */
  private splitIntoChunks(text: string): string[] {
    // Markdown 記法（見出し、リスト、テーブル、コードブロック等）を除去
    const plain = text
      .replace(/```[\s\S]*?```/g, '')       // コードブロック
      .replace(/^\s*#{1,6}\s+/gm, '')       // 見出し
      .replace(/^\s*[-*]\s+/gm, '')         // リスト
      .replace(/^\s*\d+\.\s+/gm, '')        // 番号リスト
      .replace(/^\s*>\s+/gm, '')            // 引用
      .replace(/\|[^|]*\|/g, '')            // テーブル
      .replace(/\*\*([^*]+)\*\*/g, '$1')    // 太字
      .replace(/\*([^*]+)\*/g, '$1')        // イタリック
      .replace(/`([^`]+)`/g, '$1')          // インラインコード
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // リンク

    // 句読点で分割（句読点を保持）
    const raw = plain.split(/(?<=[。！？\n])/g)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    if (raw.length === 0) return [text]

    // 短すぎるチャンク（10文字未満）は次と結合
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
   * 単一チャンクの TTS 合成（Polly API 呼び出し）
   *
   * @returns 音声バイナリ（Uint8Array）。失敗時は null。
   */
  private async synthesizeChunk(text: string, apiBaseUrl: string, accessToken: string): Promise<Uint8Array | null> {
    try {
      const res = await fetch(`${apiBaseUrl}/tts/synthesize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          text,
          voiceId: 'Tomoko',
          engine: 'neural',
        }),
      })

      if (!res.ok) return null

      const data = await res.json()
      const binary = atob(data.audio)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      return bytes
    } catch {
      return null
    }
  }

  /**
   * 音声バイナリを再生し、完了まで待機
   */
  private async playAudioBytes(bytes: Uint8Array): Promise<void> {
    // 音量エンベロープを事前計算
    await this.computeVolumeEnvelope(bytes)

    // Blob → Object URL → 再生
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/mpeg' })
    const url = URL.createObjectURL(blob)

    this.currentUrl = url
    const audio = new Audio(url)
    this.currentAudio = audio

    await audio.play()
    this.startVolumeLoop(audio)

    // 再生完了まで待機
    await new Promise<void>((resolve) => {
      audio.addEventListener('ended', () => {
        this.stopVolumeLoop()
        this.cleanupCurrent()
        resolve()
      }, { once: true })
      audio.addEventListener('pause', () => resolve(), { once: true })
    })
  }

  /**
   * テキストを音声合成して再生（チャンク並列取得 + 順次再生）
   *
   * 1. テキストを文単位に分割
   * 2. 最初のチャンクを先行して TTS 合成・再生開始
   * 3. 残りのチャンクは並列で TTS 合成（バックグラウンド）
   * 4. 先行チャンクの再生が終わったら次のチャンクを順次再生
   */
  async synthesizeAndPlay(text: string): Promise<void> {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
    if (!apiBaseUrl) {
      console.warn('[TTS] VITE_API_BASE_URL が未設定です')
      return
    }

    const accessToken = await getIdToken()
    if (!accessToken) {
      console.warn('[TTS] 認証トークンがありません')
      return
    }

    // URL を除去して読み上げテキストを準備
    const ttsText = this.stripUrls(text)
    if (!ttsText) {
      console.warn('[TTS] URL 除去後にテキストが空になりました')
      return
    }

    // 前の再生を停止
    this.stop()
    this.aborted = false

    const chunks = this.splitIntoChunks(ttsText)
    console.log(`[TTS] チャンク分割: ${chunks.length} 件`)

    // 1チャンクの場合は従来通り一括処理
    if (chunks.length <= 1) {
      try {
        const bytes = await this.synthesizeChunk(ttsText, apiBaseUrl, accessToken)
        if (!bytes || this.aborted) return
        await this.playAudioBytes(bytes)
      } catch (e) {
        console.warn('[TTS] 音声合成/再生に失敗:', e)
        this.stopVolumeLoop()
        this.cleanupCurrent()
      }
      return
    }

    // 複数チャンクの場合: 最初のチャンクを先行取得、残りは並列取得
    try {
      // 最初のチャンクを先行合成
      const firstPromise = this.synthesizeChunk(chunks[0], apiBaseUrl, accessToken)

      // 残りのチャンクを並列合成（先行チャンクの再生中にバックグラウンドで取得）
      const restPromises = chunks.slice(1).map((chunk) =>
        this.synthesizeChunk(chunk, apiBaseUrl, accessToken)
      )

      // 最初のチャンクが来たら即再生
      const firstBytes = await firstPromise
      if (!firstBytes || this.aborted) return

      console.log(`[TTS] 先行チャンク再生開始（残り ${restPromises.length} チャンク並列取得中）`)
      await this.playAudioBytes(firstBytes)

      // 残りのチャンクを順次再生
      const restResults = await Promise.all(restPromises)
      for (const bytes of restResults) {
        if (this.aborted) break
        if (!bytes) continue
        await this.playAudioBytes(bytes)
      }
    } catch (e) {
      console.warn('[TTS] チャンク再生エラー:', e)
      this.stopVolumeLoop()
      this.cleanupCurrent()
    }
  }

  /**
   * AudioContext.decodeAudioData で音声をデコードし、RMS 音量エンベロープを事前計算
   * createMediaElementSource を使わないため iOS Safari 等でも安定動作する
   */
  private async computeVolumeEnvelope(audioBytes: Uint8Array): Promise<void> {
    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext()
      }
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume()
      }

      // ArrayBuffer をコピーして渡す（decodeAudioData は所有権を取る）
      const copied = new Uint8Array(audioBytes).buffer
      const audioBuffer = await this.audioContext.decodeAudioData(copied)
      const channelData = audioBuffer.getChannelData(0)
      const sampleRate = audioBuffer.sampleRate
      const samplesPerFrame = Math.floor(sampleRate / TtsServiceImpl.ENVELOPE_FPS)
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
        // 0〜1 にスケーリング（音声の RMS は通常 0〜0.3 程度）
        envelope[i] = Math.min(1, rms * 4)
      }

      this.volumeEnvelope = envelope
    } catch (e) {
      console.warn('[TTS] 音量エンベロープの計算に失敗:', e)
      this.volumeEnvelope = null
    }
  }

  /**
   * rAF ループで audio.currentTime に基づき事前計算済み音量を通知
   */
  private startVolumeLoop(audio: HTMLAudioElement): void {
    if (!this.volumeEnvelope || !this.volumeCallback) return

    const envelope = this.volumeEnvelope
    const fps = TtsServiceImpl.ENVELOPE_FPS

    const loop = () => {
      const frameIndex = Math.floor(audio.currentTime * fps)
      const volume = frameIndex < envelope.length ? envelope[frameIndex] : 0
      this.volumeCallback?.(volume)
      this.animationFrameId = requestAnimationFrame(loop)
    }

    this.animationFrameId = requestAnimationFrame(loop)
  }

  /**
   * 音量通知ループを停止し口を閉じる
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
    this.stopVolumeLoop()
    if (this.currentAudio) {
      this.currentAudio.pause()
      this.currentAudio.currentTime = 0
    }
    this.cleanupCurrent()
  }

  /**
   * 現在再生中のリソースをクリーンアップ
   */
  private cleanupCurrent(): void {
    this.volumeEnvelope = null
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl)
      this.currentUrl = null
    }
    this.currentAudio = null
  }
}

/**
 * TTS サービスのシングルトンインスタンス
 */
export const ttsService = new TtsServiceImpl()

/**
 * テスト用に TtsServiceImpl クラスをエクスポート
 */
export { TtsServiceImpl }
