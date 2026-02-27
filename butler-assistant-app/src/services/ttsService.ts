import { useAuthStore } from '@/auth'

/**
 * TTS サービス
 * Amazon Polly API を呼び出してアシスタント返信を音声再生する
 */
class TtsServiceImpl {
  /** 現在再生中の Audio インスタンス */
  private currentAudio: HTMLAudioElement | null = null
  /** 現在の Object URL（メモリリーク防止用） */
  private currentUrl: string | null = null

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

    const accessToken = useAuthStore.getState().accessToken
    if (!accessToken) {
      console.warn('[TTS] 認証トークンがありません')
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
          text,
          voiceId: 'Tomoko',
          engine: 'neural',
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }

      const data = await res.json()

      // base64 → Blob → Object URL → 再生
      const binary = atob(data.audio)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      const blob = new Blob([bytes], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)

      this.currentUrl = url
      const audio = new Audio(url)
      this.currentAudio = audio

      // 再生完了時にクリーンアップ
      audio.addEventListener('ended', () => {
        this.cleanup()
      })

      await audio.play()
    } catch (e) {
      console.warn('[TTS] 音声合成/再生に失敗:', e)
      this.cleanup()
    }
  }

  /**
   * 現在の再生を停止
   */
  stop(): void {
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
