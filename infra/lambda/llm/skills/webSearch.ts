const BRAVE_SEARCH_API_BASE = 'https://api.search.brave.com/res/v1/web/search'

interface BraveSearchResult {
  title?: string
  url?: string
  description?: string
}

interface BraveSearchResponse {
  web?: {
    results?: BraveSearchResult[]
  }
}

/**
 * Brave Search API でWeb検索
 */
export async function webSearch(
  input: Record<string, unknown>
): Promise<string> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY
  if (!apiKey) {
    return 'Web検索機能が設定されていません。管理者に BRAVE_SEARCH_API_KEY の設定を依頼してください。'
  }

  const { query } = input as { query: string }

  const params = new URLSearchParams({
    q: query,
    count: '5',
  })

  const res = await fetch(`${BRAVE_SEARCH_API_BASE}?${params.toString()}`, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
  })

  if (!res.ok) {
    const errorText = await res.text()
    console.error('[WebSearch] API エラー:', res.status, errorText)
    return `Web検索中にエラーが発生しました（ステータス: ${res.status}）`
  }

  const data = (await res.json()) as BraveSearchResponse
  const items = data.web?.results ?? []

  if (items.length === 0) {
    return `「${query}」に一致する検索結果が見つかりませんでした。`
  }

  const results = items.map((item) => ({
    title: item.title ?? '',
    link: item.url ?? '',
    snippet: item.description ?? '',
  }))

  return JSON.stringify(results)
}
