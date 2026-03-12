import { useEffect } from 'react'
import { useNavigate } from 'react-router'

/**
 * AibaAlphaScreen — /aiba へリダイレクト
 *
 * 音声会話機能は マイAi-Ba タブに統合済み。
 * 既存のブックマーク・履歴からのアクセスを /aiba にリダイレクト。
 */
export function AibaAlphaScreen() {
  const navigate = useNavigate()

  useEffect(() => {
    navigate('/aiba', { replace: true })
  }, [navigate])

  return null
}
