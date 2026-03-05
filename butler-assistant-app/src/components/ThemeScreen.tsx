import { useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useThemeStore } from '@/stores/themeStore'
import { themeService } from '@/services/themeService'
import { ThemeList } from './ThemeList'
import { ThemeChat } from './ThemeChat'

/**
 * テーマ画面ルートコンポーネント
 */
export function ThemeScreen() {
  const { themeId: paramThemeId } = useParams<{ themeId?: string }>()
  const navigate = useNavigate()

  const themes = useThemeStore((s) => s.themes)
  const activeThemeId = useThemeStore((s) => s.activeThemeId)
  const isLoading = useThemeStore((s) => s.isLoading)
  const error = useThemeStore((s) => s.error)
  const setThemes = useThemeStore((s) => s.setThemes)
  const setActiveTheme = useThemeStore((s) => s.setActiveTheme)
  const setLoading = useThemeStore((s) => s.setLoading)
  const setError = useThemeStore((s) => s.setError)
  const removeTheme = useThemeStore((s) => s.removeTheme)

  /** テーマ一覧を取得 */
  const loadThemes = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await themeService.listThemes()
      setThemes(result)
    } catch (err) {
      console.error('[ThemeScreen] テーマ一覧の取得に失敗:', err)
      setError('テーマ一覧の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [setThemes, setLoading, setError])

  // マウント時にテーマ一覧を取得
  useEffect(() => {
    loadThemes()
  }, [loadThemes])

  // URL パラメータからテーマ ID を同期
  useEffect(() => {
    if (paramThemeId && paramThemeId !== activeThemeId) {
      setActiveTheme(paramThemeId)
    } else if (!paramThemeId && activeThemeId) {
      setActiveTheme(null)
    }
  }, [paramThemeId, activeThemeId, setActiveTheme])

  /** テーマを選択 */
  const handleSelectTheme = useCallback((themeId: string) => {
    setActiveTheme(themeId)
    navigate(`/themes/${themeId}`)
  }, [setActiveTheme, navigate])

  /** テーマを作成 */
  const handleCreateTheme = useCallback(async (themeName: string) => {
    const result = await themeService.createTheme(themeName)
    await loadThemes()
    handleSelectTheme(result.themeId)
  }, [loadThemes, handleSelectTheme])

  /** デフォルト名で即時作成（モーダルなし） */
  const handleQuickCreate = useCallback(async () => {
    await handleCreateTheme('新規トピック')
  }, [handleCreateTheme])

  /** テーマを削除（楽観的UI: 即座にリストから除去） */
  const handleDeleteTheme = useCallback(async (themeId: string) => {
    // 楽観的にUIから即削除
    removeTheme(themeId)
    if (activeThemeId === themeId) {
      setActiveTheme(null)
      navigate('/themes')
    }
    try {
      await themeService.deleteTheme(themeId)
    } catch {
      // 失敗時はサーバーから再取得して復元
      await loadThemes()
    }
  }, [activeThemeId, setActiveTheme, navigate, removeTheme, loadThemes])

  /** 一覧に戻る */
  const handleBack = useCallback(() => {
    setActiveTheme(null)
    navigate('/themes')
  }, [setActiveTheme, navigate])

  // テーマ情報を取得
  const activeTheme = themes.find((t) => t.themeId === activeThemeId)

  // テーマが選択されている場合はチャット画面
  if (activeThemeId && activeTheme) {
    return (
      <ThemeChat
        themeId={activeThemeId}
        themeName={activeTheme.themeName}
        onBack={handleBack}
      />
    )
  }

  // テーマ一覧
  return (
    <ThemeList
      themes={themes}
      onSelectTheme={handleSelectTheme}
      onCreate={handleQuickCreate}
      onDelete={handleDeleteTheme}
      isLoading={isLoading}
      error={error}
    />
  )
}
