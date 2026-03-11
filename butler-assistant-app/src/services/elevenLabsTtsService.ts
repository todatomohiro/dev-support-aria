import { getIdToken } from '@/auth'

/**
 * ElevenLabs TTS サービス
 *
 * Lambda プロキシ経由で ElevenLabs API を呼び出し、高品質な音声合成を行う。
 * 文単位のチャンク分割 + 並列取得 + 順次再生でストリーミング的な体験を提供。
 * 既存の ttsService と同じリップシンクインターフェースを持つ。
 */
class ElevenLabsTtsServiceImpl {
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

  private static readonly ENVELOPE_FPS = 60

  /** 音声再生中かどうかを返す */
  get isSpeaking(): boolean {
    return this.currentAudio !== null && !this.currentAudio.paused
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
   * テキストを文単位のチャンクに分割
   */
  private splitIntoChunks(text: string): string[] {
    const plain = text
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

    const raw = plain.split(/(?<=[。！？\n])/g)
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
   * 単一チャンクの ElevenLabs TTS 合成（Lambda プロキシ経由）
   */
  private async synthesizeChunk(text: string, apiBaseUrl: string, accessToken: string): Promise<Uint8Array | null> {
    try {
      const res = await fetch(`${apiBaseUrl}/tts/synthesize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ text, provider: 'elevenlabs' }),
      })

      if (!res.ok) {
        console.warn(`[ElevenLabs TTS] API エラー: ${res.status}`)
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
      console.warn('[ElevenLabs TTS] 合成エラー:', e)
      return null
    }
  }

  /**
   * 音声バイナリを再生し、完了まで待機
   */
  private async playAudioBytes(bytes: Uint8Array): Promise<void> {
    await this.computeVolumeEnvelope(bytes)

    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/mpeg' })
    const url = URL.createObjectURL(blob)

    this.currentUrl = url
    const audio = new Audio(url)
    this.currentAudio = audio

    await audio.play()
    this.startVolumeLoop(audio)

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
   */
  async synthesizeAndPlay(text: string): Promise<void> {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
    if (!apiBaseUrl) {
      console.warn('[ElevenLabs TTS] VITE_API_BASE_URL が未設定です')
      return
    }

    const accessToken = await getIdToken()
    if (!accessToken) {
      console.warn('[ElevenLabs TTS] 認証トークンがありません')
      return
    }

    const ttsText = this.stripUrls(text)
    if (!ttsText) return

    this.stop()
    this.aborted = false

    const chunks = this.splitIntoChunks(ttsText)
    console.log(`[ElevenLabs TTS] チャンク分割: ${chunks.length} 件`)

    if (chunks.length <= 1) {
      try {
        const bytes = await this.synthesizeChunk(ttsText, apiBaseUrl, accessToken)
        if (!bytes || this.aborted) return
        await this.playAudioBytes(bytes)
      } catch (e) {
        console.warn('[ElevenLabs TTS] 音声合成/再生に失敗:', e)
        this.stopVolumeLoop()
        this.cleanupCurrent()
      }
      return
    }

    try {
      const firstPromise = this.synthesizeChunk(chunks[0], apiBaseUrl, accessToken)
      const restPromises = chunks.slice(1).map((chunk) =>
        this.synthesizeChunk(chunk, apiBaseUrl, accessToken)
      )

      const firstBytes = await firstPromise
      if (!firstBytes || this.aborted) return

      console.log(`[ElevenLabs TTS] 先行チャンク再生開始（残り ${restPromises.length} チャンク並列取得中）`)
      await this.playAudioBytes(firstBytes)

      const restResults = await Promise.all(restPromises)
      for (const bytes of restResults) {
        if (this.aborted) break
        if (!bytes) continue
        await this.playAudioBytes(bytes)
      }
    } catch (e) {
      console.warn('[ElevenLabs TTS] チャンク再生エラー:', e)
      this.stopVolumeLoop()
      this.cleanupCurrent()
    }
  }

  /**
   * 音量エンベロープを事前計算（リップシンク用）
   */
  private async computeVolumeEnvelope(audioBytes: Uint8Array): Promise<void> {
    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext()
      }
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume()
      }

      const copied = new Uint8Array(audioBytes).buffer
      const audioBuffer = await this.audioContext.decodeAudioData(copied)
      const channelData = audioBuffer.getChannelData(0)
      const sampleRate = audioBuffer.sampleRate
      const samplesPerFrame = Math.floor(sampleRate / ElevenLabsTtsServiceImpl.ENVELOPE_FPS)
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
      console.warn('[ElevenLabs TTS] 音量エンベロープの計算に失敗:', e)
      this.volumeEnvelope = null
    }
  }

  /**
   * rAF ループで音量を通知
   */
  private startVolumeLoop(audio: HTMLAudioElement): void {
    if (!this.volumeEnvelope || !this.volumeCallback) return

    const envelope = this.volumeEnvelope
    const fps = ElevenLabsTtsServiceImpl.ENVELOPE_FPS

    const loop = () => {
      const frameIndex = Math.floor(audio.currentTime * fps)
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
    this.stopVolumeLoop()
    if (this.currentAudio) {
      this.currentAudio.pause()
      this.currentAudio.currentTime = 0
    }
    this.cleanupCurrent()
  }

  /**
   * リソースクリーンアップ
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
 * ElevenLabs TTS サービスのシングルトンインスタンス
 */
export const elevenLabsTtsService = new ElevenLabsTtsServiceImpl()
