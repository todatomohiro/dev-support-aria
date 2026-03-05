import { useCallback, useEffect, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useThemeStore } from '@/stores/themeStore'
import { useAppStore } from '@/stores'
import { DEFAULT_MODEL_KEY } from '@/types'
import type { ModelKey, TopicCategory, TopicSubcategory } from '@/types'
import { chatController } from '@/services/chatController'
import { useThemePolling } from '@/hooks/useThemePolling'
import { themeService } from '@/services/themeService'
import { workService } from '@/services/workService'
import { ttsService } from '@/services/ttsService'
import { motionController } from '@/services/motionController'
import { ChatUI } from './ChatUI'
import { WorkBadge } from './WorkBadge'
import { ModelSelector } from './ModelSelector'
import { CategorySelect } from './CategorySelect'

interface ThemeChatProps {
  themeId: string
  themeName: string
  onBack: () => void
}

/**
 * テーマ別チャット画面
 */
export function ThemeChat({ themeId }: ThemeChatProps) {
  const messages = useThemeStore((s) => s.activeMessages)
  const isSending = useThemeStore((s) => s.isSending)
  const themes = useThemeStore((s) => s.themes)
  const config = useAppStore((s) => s.config)
  const workConnection = useThemeStore((s) => s.activeWorkConnection)
  const expiredNotifiedRef = useRef(false)

  // 他ブラウザ/タブからのメッセージ同期用ポーリング
  useThemePolling(themeId)

  const currentTheme = themes.find((t) => t.themeId === themeId)
  const currentModelKey = currentTheme?.modelKey ?? DEFAULT_MODEL_KEY
  const hasCategory = Boolean(currentTheme?.category)

  /** モデル変更ハンドラー */
  const handleModelChange = useCallback(async (modelKey: ModelKey) => {
    try {
      await themeService.updateThemeModel(themeId, modelKey)
      useThemeStore.getState().updateThemeModelKey(themeId, modelKey)
    } catch (error) {
      console.error('[ThemeChat] モデル変更エラー:', error)
    }
  }, [themeId])

  /** カテゴリ選択ハンドラー（サブカテゴリ選択後にAI自動挨拶） */
  const handleCategorySelect = useCallback(async (category: TopicCategory, subcategory?: TopicSubcategory) => {
    try {
      // 先にUI状態を更新（楽観的更新）
      useThemeStore.getState().updateThemeCategory(themeId, category.key, category.modelKey, subcategory?.key)

      // バックエンドに保存（完了を待ってからLLM呼出、エラーでもUI遷移は維持）
      await themeService.updateThemeCategory(themeId, category.key, category.modelKey, subcategory?.key)
        .catch((err) => console.warn('[ThemeChat] カテゴリ保存エラー:', err))

      // AI自動挨拶をトリガー
      const triggerText = subcategory
        ? `${subcategory.label}について相談したい`
        : '相談したい'
      await chatController.sendThemeMessage(triggerText, themeId)
    } catch (error) {
      console.error('[ThemeChat] カテゴリ設定エラー:', error)
    }
  }, [themeId])

  // テーマ切り替え時にサーバーからメッセージを読み込む
  useEffect(() => {
    const store = useThemeStore.getState()
    // 既にメッセージがある場合はスキップ（送信中の再レンダリング防止）
    if (store.activeMessages.length > 0) return

    themeService.listMessages(themeId).then((serverMessages) => {
      if (serverMessages.length > 0) {
        store.setActiveMessages(serverMessages)
      }
    }).catch((err) => {
      console.warn('[ThemeChat] メッセージ読み込みエラー:', err)
    })
  }, [themeId])

  // マウント時にワーク接続状態を取得
  useEffect(() => {
    const store = useThemeStore.getState()
    expiredNotifiedRef.current = false

    workService.getStatus(themeId).then((conn) => {
      if (conn.active) {
        store.setWorkConnection(conn)
      } else {
        store.clearWorkConnection()
      }
    }).catch(() => {
      // ワーク接続がなくてもエラーにしない
      store.clearWorkConnection()
    })
  }, [themeId])

  // ワーク初回アクセス時の greeting 表示 + TTS発話
  const greetingShownRef = useRef(false)
  useEffect(() => {
    if (greetingShownRef.current) return
    if (!workConnection?.active || !workConnection.greeting) return

    const store = useThemeStore.getState()
    if (store.activeMessages.length > 0) return

    greetingShownRef.current = true

    // greeting メッセージを追加
    store.addMessage({
      id: uuidv4(),
      role: 'assistant',
      content: workConnection.greeting,
      timestamp: Date.now(),
      motion: 'smile',
    })

    // description があれば2つ目のメッセージとして追加
    if (workConnection.description) {
      store.addMessage({
        id: uuidv4(),
        role: 'assistant',
        content: workConnection.description,
        timestamp: Date.now() + 1,
        motion: 'idle',
        suggestedReplies: workConnection.suggestedReplies,
      })
    } else if (workConnection.suggestedReplies?.length) {
      // description がない場合は greeting メッセージを更新して suggestedReplies を付与
      const msgs = useThemeStore.getState().activeMessages
      const lastMsg = msgs[msgs.length - 1]
      if (lastMsg) {
        store.setActiveMessages(msgs.map((m) =>
          m.id === lastMsg.id ? { ...m, suggestedReplies: workConnection.suggestedReplies } : m
        ))
      }
    }

    // TTS で greeting を発話 + モーション再生
    ttsService.synthesizeAndPlay(workConnection.greeting)
    motionController.playMotion('smile')
  }, [workConnection?.active, workConnection?.greeting])

  // ワーク有効期限のチェック（10秒間隔）
  useEffect(() => {
    if (!workConnection?.active || !workConnection.expiresAt) return

    const check = () => {
      const remaining = new Date(workConnection.expiresAt).getTime() - Date.now()
      if (remaining <= 0 && !expiredNotifiedRef.current) {
        expiredNotifiedRef.current = true
        const store = useThemeStore.getState()
        store.clearWorkConnection()
        // 失効メッセージをチャットに追加
        store.addMessage({
          id: uuidv4(),
          role: 'assistant',
          content: '当トピックに紐づいているワーク機能は、ご利用を終了いたしました。',
          timestamp: Date.now(),
          motion: 'idle',
        })
      }
    }

    check()
    const timer = setInterval(check, 10_000)
    return () => clearInterval(timer)
  }, [workConnection?.active, workConnection?.expiresAt])

  /** 壁打ちモード開始ハンドラー */
  const handleSocraticStart = useCallback(async () => {
    try {
      const socraticModel = 'sonnet' as const
      useThemeStore.getState().updateThemeCategory(themeId, 'free', socraticModel, 'socratic')
      await themeService.updateThemeCategory(themeId, 'free', socraticModel, 'socratic')
        .catch((err) => console.warn('[ThemeChat] 壁打ちモード保存エラー:', err))
      await chatController.sendThemeMessage('壁打ち相手になって。私の考えを深掘りしてほしい。', themeId)
    } catch (error) {
      console.error('[ThemeChat] 壁打ちモード開始エラー:', error)
    }
  }, [themeId])

  /** 壁打ちモードのトグルハンドラー */
  const handleSocraticToggle = useCallback(async (enabled: boolean) => {
    const cat = currentTheme?.category || 'free'
    const sub = enabled ? 'socratic' : undefined
    useThemeStore.getState().updateThemeCategory(themeId, cat, currentModelKey, sub)
    await themeService.updateThemeCategory(themeId, cat, currentModelKey, sub)
      .catch((err) => console.warn('[ThemeChat] 壁打ちモードエラー:', err))
  }, [themeId, currentModelKey, currentTheme?.category])

  const handleSendMessage = useCallback(async (text: string, imageBase64?: string) => {
    await chatController.sendThemeMessage(text, themeId, imageBase64)
  }, [themeId])

  return (
    <div className="flex flex-col h-full" data-testid="theme-chat">
      {/* ワークバッジ */}
      {workConnection && (
        <div className="px-4 pt-2 shrink-0">
          <WorkBadge active={workConnection.active} expiresAt={workConnection.expiresAt} />
        </div>
      )}

      {/* カテゴリ選択（メッセージなし＆カテゴリ未設定時） */}
      {messages.length === 0 && !hasCategory && !workConnection && (
        <div className="flex flex-col">
          <CategorySelect onSelect={handleCategorySelect} developerMode={config.ui.developerMode} />
          <div className="px-4 -mt-5">
            <button
              type="button"
              className="px-5 py-3 text-sm font-medium rounded-full border border-purple-300 dark:border-purple-600 text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/30 hover:border-purple-400 dark:hover:border-purple-500 hover:shadow-sm transition-all"
              onClick={handleSocraticStart}
            >
              💭 壁打ち相手になって
            </button>
          </div>
        </div>
      )}

      {/* チャットエリア */}
      <div className="flex-1 flex flex-col min-h-0" style={{ fontSize: `${config.ui.fontSize}px` }}>
        <ChatUI
          messages={messages}
          isLoading={isSending}
          onSendMessage={handleSendMessage}
          ttsEnabled={config.ui.ttsEnabled}
          onToggleTts={(enabled) => useAppStore.getState().updateConfig({ ui: { ...config.ui, ttsEnabled: enabled } })}
          cameraEnabled={config.ui.cameraEnabled}
          onToggleCamera={(enabled) => useAppStore.getState().updateConfig({ ui: { ...config.ui, cameraEnabled: enabled } })}
          developerMode={config.ui.developerMode}
          hasEarlierMessages={false}
          isLoadingEarlier={false}
          onLoadEarlier={() => {}}
          extraOptions={[{
            key: 'socratic',
            label: '壁打ちモード',
            icon: '💭',
            enabled: currentTheme?.subcategory === 'socratic',
            onToggle: handleSocraticToggle,
          }]}
          persistentReplies={workConnection?.active && workConnection.suggestedRepliesPersistent ? workConnection.suggestedReplies : undefined}
          persistentRepliesTemplate={workConnection?.active && workConnection.suggestedRepliesPersistent ? workConnection.suggestedRepliesTemplate : undefined}
          inputExtra={<ModelSelector modelKey={currentModelKey} onChange={handleModelChange} />}
        />
      </div>
    </div>
  )
}
