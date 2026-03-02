import { useCallback, useEffect } from 'react'
import { useThemeStore } from '@/stores/themeStore'
import { useAppStore } from '@/stores'
import { chatController } from '@/services/chatController'
import { themeService } from '@/services/themeService'
import { ChatUI } from './ChatUI'

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
  const config = useAppStore((s) => s.config)

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

  const handleSendMessage = useCallback(async (text: string, imageBase64?: string) => {
    await chatController.sendThemeMessage(text, themeId, imageBase64)
  }, [themeId])

  return (
    <div className="flex flex-col h-full" data-testid="theme-chat">
      {/* チャットエリア */}
      <div className="flex-1 flex flex-col min-h-0" style={{ fontSize: `${config.ui.fontSize}px` }}>
        <ChatUI
          messages={messages}
          isLoading={isSending}
          onSendMessage={handleSendMessage}
          ttsEnabled={config.ui.ttsEnabled}
          onToggleTts={() => {}}
          cameraEnabled={config.ui.cameraEnabled}
          onToggleCamera={() => {}}
          developerMode={config.ui.developerMode}
          hasEarlierMessages={false}
          isLoadingEarlier={false}
          onLoadEarlier={() => {}}
        />
      </div>
    </div>
  )
}
