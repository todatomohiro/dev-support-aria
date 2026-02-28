const PLACES_API_BASE = 'https://places.googleapis.com/v1/places:searchText'

interface PlaceResult {
  displayName?: { text: string }
  formattedAddress?: string
  location?: { latitude: number; longitude: number }
  rating?: number
}

/**
 * Google Places API (New) で場所を検索
 */
export async function searchPlaces(
  input: Record<string, unknown>
): Promise<string> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    return '場所検索機能が設定されていません。管理者に GOOGLE_PLACES_API_KEY の設定を依頼してください。'
  }

  const { query, locationBias } = input as {
    query: string
    locationBias?: { lat: number; lng: number }
  }

  const body: Record<string, unknown> = {
    textQuery: query,
    maxResultCount: 5,
    languageCode: 'ja',
  }

  if (locationBias) {
    body.locationBias = {
      circle: {
        center: { latitude: locationBias.lat, longitude: locationBias.lng },
        radius: 5000,
      },
    }
  }

  const res = await fetch(PLACES_API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.rating',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errorText = await res.text()
    console.error('[Places] API エラー:', res.status, errorText)
    return `場所の検索中にエラーが発生しました（ステータス: ${res.status}）`
  }

  const data = (await res.json()) as { places?: PlaceResult[] }
  const places = data.places ?? []

  if (places.length === 0) {
    return `「${query}」に一致する場所が見つかりませんでした。`
  }

  const results = places.map((p) => ({
    name: p.displayName?.text ?? '不明',
    address: p.formattedAddress ?? '',
    lat: p.location?.latitude ?? 0,
    lng: p.location?.longitude ?? 0,
    rating: p.rating,
  }))

  return JSON.stringify(results)
}
