import { useCallback } from 'react'
import { useThemeStore } from '@/stores/themeStore'
import { useAppStore } from '@/stores'
import { chatController } from '@/services/chatController'
import { ChatUI } from './ChatUI'

interface ThemeChatProps {
  themeId: string
  themeName: string
  onBack: () => void
}

/**
 * テーマ別チャット画面
 */
export function ThemeChat({ themeId, themeName, onBack }: ThemeChatProps) {
  const messages = useThemeStore((s) => s.activeMessages)
  const isSending = useThemeStore((s) => s.isSending)
  const config = useAppStore((s) => s.config)

  const handleSendMessage = useCallback(async (text: string, imageBase64?: string) => {
    await chatController.sendThemeMessage(text, themeId, imageBase64)
  }, [themeId])

  return (
    <div className="flex flex-col h-full" data-testid="theme-chat">
      {/* スマホ用ヘッダー */}
      <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
          data-testid="theme-chat-back"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{themeName}</h3>
      </div>

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
