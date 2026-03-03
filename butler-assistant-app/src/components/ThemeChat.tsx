import { useCallback, useEffect, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useThemeStore } from '@/stores/themeStore'
import { useAppStore } from '@/stores'
import { chatController } from '@/services/chatController'
import { themeService } from '@/services/themeService'
import { workService } from '@/services/workService'
import { ChatUI } from './ChatUI'
import { WorkBadge } from './WorkBadge'

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
  const workConnection = useThemeStore((s) => s.activeWorkConnection)
  const expiredNotifiedRef = useRef(false)

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
