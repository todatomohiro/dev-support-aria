import { getIdToken } from '@/auth'

/**
 * TTS サービス
 * Amazon Polly API を呼び出してアシスタント返信を音声再生する
 * 音声データを事前デコードして音量エンベロープを計算しリップシンクに利用
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
   * テキストを音声合成して再生
   * 再生中に新しいリクエストが来たら前の再生を停止して新しい方を再生
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

    try {
      const res = await fetch(`${apiBaseUrl}/tts/synthesize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          text: ttsText,
          voiceId: 'Tomoko',
          engine: 'neural',
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }

      const data = await res.json()

      // base64 → Uint8Array
      const binary = atob(data.audio)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }

      // 音量エンベロープを事前計算（createMediaElementSource を使わない方式）
      await this.computeVolumeEnvelope(bytes)

      // Blob → Object URL → 再生
      const blob = new Blob([bytes], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)

      this.currentUrl = url
      const audio = new Audio(url)
      this.currentAudio = audio

      await audio.play()
      this.startVolumeLoop(audio)

      // 再生完了または停止まで待機
      await new Promise<void>((resolve) => {
        audio.addEventListener('ended', () => {
          this.stopVolumeLoop()
          this.cleanup()
          resolve()
        }, { once: true })
        audio.addEventListener('pause', () => resolve(), { once: true })
      })
    } catch (e) {
      console.warn('[TTS] 音声合成/再生に失敗:', e)
      this.stopVolumeLoop()
      this.cleanup()
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
    this.stopVolumeLoop()
    if (this.currentAudio) {
      this.currentAudio.pause()
      this.currentAudio.currentTime = 0
    }
    this.cleanup()
  }

  /**
   * リソースをクリーンアップ
   */
  private cleanup(): void {
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
