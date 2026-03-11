import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { useAppStore } from '@/stores'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
import { chatController } from '@/services/chatController'
import { elevenLabsTtsService } from '@/services/elevenLabsTtsService'
import { ttsService } from '@/services/ttsService'

/** 会話ターン */
interface VoiceTurn {
  role: 'user' | 'assistant'
  text: string
  timestamp: number
  emotion?: string
}

type VoiceState = 'connecting' | 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'

/** 応答待ちタイムアウト（60秒） */
const THINKING_TIMEOUT_MS = 60_000

/**
 * マイAi-Ba(α) — 音声会話画面
 *
 * ダークテーマのフルスクリーン音声会話UI。
 * STT → Bedrock ConverseStream → TTS のパイプラインで音声会話を実現。
 */
export function VoiceChatScreen() {
  const navigate = useNavigate()
  const streamingText = useAppStore((s) => s.streamingText)

  const [voiceState, setVoiceState] = useState<VoiceState>('connecting')
  const [turns, setTurns] = useState<VoiceTurn[]>([])
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [currentEmotion] = useState('neutral')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const startTimeRef = useRef(Date.now())
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const isEndingRef = useRef(false)
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const voiceStateRef = useRef<VoiceState>('connecting')
  /** 最後に処理したメッセージの ID（count ベースだと MAX_MESSAGE_HISTORY で停滞する） */
  const lastProcessedMsgIdRef = useRef<string | null>(
    (() => {
      const msgs = useAppStore.getState().messages
      return msgs.length > 0 ? msgs[msgs.length - 1].id : null
    })()
  )

  /** voiceState を更新し、ref も同期する */
  const updateVoiceState = useCallback((next: VoiceState) => {
    voiceStateRef.current = next
    setVoiceState(next)
  }, [])

  // タイマー
  useEffect(() => {
    startTimeRef.current = Date.now()
    timerRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
    const connectTimer = setTimeout(() => updateVoiceState('idle'), 800)
    return () => {
      clearInterval(timerRef.current)
      clearTimeout(connectTimer)
    }
  }, [updateVoiceState])

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (thinkingTimerRef.current) {
        clearTimeout(thinkingTimerRef.current)
      }
    }
  }, [])

  /**
   * TTS 再生（ElevenLabs 優先、失敗時 Polly フォールバック）
   * 完了後に idle に戻す
   */
  const playTts = useCallback((text: string) => {
    console.log('[VoiceChat] TTS 開始:', text.slice(0, 30) + '...')
    updateVoiceState('speaking')

    elevenLabsTtsService.synthesizeAndPlay(text)
      .catch((e) => {
        console.warn('[VoiceChat] ElevenLabs 失敗、Polly にフォールバック:', e.message)
        return ttsService.synthesizeAndPlay(text)
      })
      .catch((e) => {
        console.warn('[VoiceChat] TTS すべて失敗:', e)
      })
      .finally(() => {
        if (!isEndingRef.current) {
          console.log('[VoiceChat] TTS 完了 → idle')
          updateVoiceState('idle')
        }
      })
  }, [updateVoiceState])

  // Zustand subscribe でメッセージを監視
  // ※ MAX_MESSAGE_HISTORY で配列長が一定になるため、最後のメッセージ ID で検出
  useEffect(() => {
    const unsubscribe = useAppStore.subscribe((state) => {
      const msgs = state.messages
      if (msgs.length === 0) return

      const lastMsg = msgs[msgs.length - 1]
      if (lastMsg.id === lastProcessedMsgIdRef.current) return

      // 新しいメッセージが追加された
      lastProcessedMsgIdRef.current = lastMsg.id

      if (lastMsg.role === 'assistant' && lastMsg.content) {
        console.log('[VoiceChat] アシスタント応答検出:', lastMsg.content.slice(0, 40))

        // thinking タイムアウトをクリア
        if (thinkingTimerRef.current) {
          clearTimeout(thinkingTimerRef.current)
          thinkingTimerRef.current = undefined
        }

        // chatController の TTS を止める（二重再生防止）
        ttsService.stop()

        setErrorMessage(null)
        setTurns((prev) => [...prev, {
          role: 'assistant',
          text: lastMsg.content,
          timestamp: Date.now(),
        }])

        playTts(lastMsg.content)
      } else if (lastMsg.role === 'user') {
        // ユーザーメッセージは無視（handleSpeechResult で既に追加済み）
      }
    })

    return () => { unsubscribe() }
  }, [playTts])

  // STT 確定テキストのハンドラー
  const handleSpeechResult = useCallback((text: string) => {
    if (!text.trim() || isMuted) return

    const current = voiceStateRef.current
    if (current === 'thinking' || current === 'speaking') {
      console.log('[VoiceChat] thinking/speaking 中のため入力を無視:', text.trim())
      return
    }

    console.log('[VoiceChat] 音声入力確定:', text.trim())

    setTurns((prev) => [...prev, {
      role: 'user',
      text: text.trim(),
      timestamp: Date.now(),
    }])
    setErrorMessage(null)
    updateVoiceState('thinking')

    // thinking タイムアウトを設定
    if (thinkingTimerRef.current) {
      clearTimeout(thinkingTimerRef.current)
    }
    thinkingTimerRef.current = setTimeout(() => {
      if (voiceStateRef.current === 'thinking') {
        console.warn('[VoiceChat] 応答タイムアウト → idle に復帰')
        setErrorMessage('応答がありませんでした。もう一度話しかけてください。')
        updateVoiceState('idle')
      }
    }, THINKING_TIMEOUT_MS)

    chatController.sendMessage(text.trim()).catch((error) => {
      console.error('[VoiceChat] sendMessage エラー:', error)
      if (thinkingTimerRef.current) {
        clearTimeout(thinkingTimerRef.current)
        thinkingTimerRef.current = undefined
      }
      setErrorMessage('送信に失敗しました。もう一度お試しください。')
      updateVoiceState('idle')
    })
  }, [isMuted, updateVoiceState])

  const {
    status: sttStatus,
    interimText,
    toggleListening,
  } = useSpeechRecognition({
    lang: 'ja-JP',
    continuous: true,
    onResult: handleSpeechResult,
  })

  // voiceState と STT status の同期
  useEffect(() => {
    if (sttStatus === 'listening' && voiceState === 'idle') {
      updateVoiceState('listening')
    }
  }, [sttStatus, voiceState, updateVoiceState])

  // idle 状態になったら自動で聞き始める
  useEffect(() => {
    if (voiceState === 'idle' && sttStatus !== 'listening' && !isMuted) {
      const timer = setTimeout(() => {
        if (!isEndingRef.current) {
          toggleListening()
        }
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [voiceState, sttStatus, isMuted, toggleListening])

  // thinking/speaking 中はSTTを停止して重複送信を防止
  useEffect(() => {
    if ((voiceState === 'thinking' || voiceState === 'speaking') && sttStatus === 'listening') {
      toggleListening()
    }
  }, [voiceState, sttStatus, toggleListening])

  /** マイクミュートトグル */
  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const newMuted = !prev
      if (newMuted && sttStatus === 'listening') {
        toggleListening()
      }
      return newMuted
    })
  }, [sttStatus, toggleListening])

  /** 会話終了 */
  const handleEndCall = useCallback(() => {
    isEndingRef.current = true
    elevenLabsTtsService.stop()
    ttsService.stop()
    if (sttStatus === 'listening') {
      toggleListening()
    }
    if (thinkingTimerRef.current) {
      clearTimeout(thinkingTimerRef.current)
    }
    clearInterval(timerRef.current)
    navigate('/aiba-alpha/summary', { state: { turns, elapsedSeconds } })
  }, [navigate, turns, elapsedSeconds, sttStatus, toggleListening])

  /** タイマー表示 */
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = (seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  /** 直近のAI発言 */
  const lastAiTurn = [...turns].reverse().find((t) => t.role === 'assistant')
  /** 直近のユーザー発言 */
  const lastUserTurn = [...turns].reverse().find((t) => t.role === 'user')

  return (
    <div className="flex-1 flex flex-col bg-gradient-to-b from-slate-900 to-slate-800 min-h-0 relative overflow-hidden">
      {/* 背景パーティクル */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute w-32 h-32 rounded-full bg-indigo-500/10 -top-8 -left-8" />
        <div className="absolute w-24 h-24 rounded-full bg-indigo-500/5 top-1/2 -right-6" />
        <div className="absolute w-16 h-16 rounded-full bg-purple-500/10 bottom-1/4 left-1/3" />
      </div>

      {/* 接続ステータス + タイマー */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0 relative z-10">
        <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-3 py-1.5">
          <div className={`w-2 h-2 rounded-full ${
            voiceState === 'connecting' ? 'bg-yellow-400 animate-pulse'
              : voiceState === 'error' ? 'bg-red-400'
              : 'bg-green-400 shadow-[0_0_6px_rgba(34,197,94,0.5)]'
          }`} />
          <span className="text-xs text-white/60 font-medium">
            {voiceState === 'connecting' ? '接続中...' : voiceState === 'error' ? 'エラー' : '接続中'}
          </span>
        </div>
        <span className="text-xs text-white/40 tabular-nums font-medium">
          {formatTime(elapsedSeconds)}
        </span>
      </div>

      {/* キャラクターエリア（大きく表示） */}
      <div className="flex-1 flex items-center justify-center relative">
        {/* TODO: Live2D キャンバスをここに配置 */}
        <div className="w-40 h-60 bg-white/5 rounded-[80px_80px_40px_40px]" />

        {/* 感情バッジ */}
        {currentEmotion !== 'neutral' && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-indigo-500/20 backdrop-blur-sm rounded-full px-3 py-1 text-xs text-white/60 font-medium">
            {currentEmotion}
          </div>
        )}
      </div>

      {/* テキスト表示エリア */}
      <div className="px-6 pb-3 min-h-[100px] flex flex-col justify-end gap-2 shrink-0 relative z-10">
        {lastUserTurn && (
          <div className="text-right">
            <div className="text-[11px] text-blue-300/50 font-semibold mb-0.5">あなた</div>
            <div className="text-sm text-blue-200/80 leading-relaxed">{lastUserTurn.text}</div>
          </div>
        )}
        {(voiceState === 'thinking' && streamingText) && (
          <div>
            <div className="text-[11px] text-indigo-400/60 font-semibold mb-0.5">Ai-Ba</div>
            <div className="text-sm text-white/70 leading-relaxed">{streamingText}</div>
          </div>
        )}
        {lastAiTurn && voiceState !== 'thinking' && (
          <div>
            <div className="text-[11px] text-indigo-400/60 font-semibold mb-0.5">Ai-Ba</div>
            <div className="text-sm text-white/80 leading-relaxed">{lastAiTurn.text}</div>
          </div>
        )}
        {errorMessage && (
          <div className="text-sm text-red-400/80 text-center">{errorMessage}</div>
        )}
        {interimText && (
          <div className="text-sm text-white/30 italic text-right">{interimText}</div>
        )}
      </div>

      {/* コントロールバー */}
      <div className="flex items-center justify-center gap-6 px-6 pb-8 pt-4 shrink-0 relative z-10">
        {/* スピーカーミュート */}
        <button
          onClick={handleToggleMute}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
            isMuted
              ? 'bg-red-500 text-white'
              : 'bg-white/10 text-white hover:bg-white/20'
          }`}
          title={isMuted ? 'ミュート解除' : 'マイクミュート'}
        >
          {isMuted ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
          )}
        </button>

        {/* メインマイクボタン */}
        <div className="relative">
          {/* AI発話中インジケーター */}
          {voiceState === 'speaking' && (
            <div className="absolute -top-10 left-1/2 -translate-x-1/2 flex items-end gap-[3px]">
              {[12, 20, 16, 24, 14].map((h, i) => (
                <div
                  key={i}
                  className="w-[3px] rounded-sm bg-indigo-400"
                  style={{
                    height: `${h}px`,
                    animation: `speaking-bar 0.8s ease-in-out infinite`,
                    animationDelay: `${i * 0.12}s`,
                  }}
                />
              ))}
            </div>
          )}
          <button
            onClick={() => {
              if (voiceState === 'idle' || voiceState === 'listening') {
                toggleListening()
              }
            }}
            disabled={voiceState === 'connecting' || voiceState === 'thinking' || voiceState === 'speaking'}
            className={`w-[72px] h-[72px] rounded-full flex items-center justify-center transition-all relative ${
              voiceState === 'listening'
                ? 'bg-blue-500 text-white shadow-[0_0_0_0_rgba(59,130,246,0.5)] animate-[mic-pulse_2s_infinite]'
                : voiceState === 'speaking'
                  ? 'bg-white/10 text-white/40'
                  : voiceState === 'thinking'
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-white/15 text-white/60 hover:bg-white/25'
            }`}
            title={
              voiceState === 'listening' ? '聞き取り中...'
                : voiceState === 'speaking' ? 'AI応答中'
                : voiceState === 'thinking' ? '考え中...'
                : 'タップして話す'
            }
          >
            {voiceState === 'thinking' ? (
              <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 10v2a7 7 0 01-14 0v-2M12 19v4m-4 0h8" />
              </svg>
            )}
          </button>
        </div>

        {/* 終了ボタン */}
        <button
          onClick={handleEndCall}
          className="w-12 h-12 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
          title="会話を終了"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M3.68 3.68a.75.75 0 011.06 0L12 10.94l7.26-7.26a.75.75 0 111.06 1.06L13.06 12l7.26 7.26a.75.75 0 11-1.06 1.06L12 13.06l-7.26 7.26a.75.75 0 01-1.06-1.06L10.94 12 3.68 4.74a.75.75 0 010-1.06z" />
          </svg>
        </button>
      </div>

      {/* CSS アニメーション */}
      <style>{`
        @keyframes mic-pulse {
          0% { box-shadow: 0 0 0 0 rgba(59,130,246,0.5); }
          70% { box-shadow: 0 0 0 20px rgba(59,130,246,0); }
          100% { box-shadow: 0 0 0 0 rgba(59,130,246,0); }
        }
        @keyframes speaking-bar {
          0%, 100% { transform: scaleY(0.4); }
          50% { transform: scaleY(1); }
        }
      `}</style>
    </div>
  )
}
