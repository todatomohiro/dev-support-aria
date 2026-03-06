const OPEN_METEO_API = 'https://api.open-meteo.com/v1/forecast'

/**
 * WMO Weather interpretation codes → 日本語天気名
 */
const WEATHER_CODES: Record<number, string> = {
  0: '快晴',
  1: '晴れ',
  2: 'くもり時々晴れ',
  3: 'くもり',
  45: '霧',
  48: '霧（着氷性）',
  51: '小雨（霧雨）',
  53: '雨（霧雨）',
  55: '強い雨（霧雨）',
  56: '着氷性の霧雨',
  57: '強い着氷性の霧雨',
  61: '小雨',
  63: '雨',
  65: '強い雨',
  66: '着氷性の雨',
  67: '強い着氷性の雨',
  71: '小雪',
  73: '雪',
  75: '大雪',
  77: '霧雪',
  80: 'にわか雨',
  81: '強いにわか雨',
  82: '激しいにわか雨',
  85: 'にわか雪',
  86: '強いにわか雪',
  95: '雷雨',
  96: '雷雨（雹あり）',
  99: '激しい雷雨（雹あり）',
}

interface OpenMeteoResponse {
  hourly: {
    time: string[]
    temperature_2m: number[]
    weathercode: number[]
    precipitation_probability: number[]
    relative_humidity_2m: number[]
    windspeed_10m: number[]
  }
}

/**
 * Open-Meteo API で天気予報を取得
 */
export async function getWeather(
  input: Record<string, unknown>,
  userLocation?: { lat: number; lng: number }
): Promise<string> {
  const lat = typeof input.latitude === 'number' ? input.latitude : userLocation?.lat
  const lng = typeof input.longitude === 'number' ? input.longitude : userLocation?.lng

  if (lat == null || lng == null) {
    return '位置情報が取得できませんでした。位置情報の許可を確認してください。'
  }

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: 'temperature_2m,weathercode,precipitation_probability,relative_humidity_2m,windspeed_10m',
    timezone: 'Asia/Tokyo',
    forecast_days: '2',
  })

  const url = `${OPEN_METEO_API}?${params.toString()}`

  // リトライ付きfetch（接続タイムアウト対策）
  let res: Response | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      break
    } catch (err) {
      console.warn(`[Weather] fetch attempt ${attempt + 1} failed:`, (err as Error).message)
      if (attempt === 2) {
        return '天気情報の取得に失敗しました。しばらくしてからもう一度試してください。'
      }
    }
  }

  if (!res || !res.ok) {
    console.error('[Weather] API エラー:', res?.status)
    return `天気情報の取得に失敗しました（ステータス: ${res?.status}）`
  }

  const data = (await res.json()) as OpenMeteoResponse
  const { time, temperature_2m, weathercode, precipitation_probability, relative_humidity_2m, windspeed_10m } = data.hourly

  // 3時間ごとにサマリー（0, 3, 6, 9, 12, 15, 18, 21時）
  const hourly = time.map((t, i) => ({
    time: t,
    hour: new Date(t).getHours(),
    temperature: temperature_2m[i],
    weather: WEATHER_CODES[weathercode[i]] ?? `不明(${weathercode[i]})`,
    precipitationProbability: precipitation_probability[i],
    humidity: relative_humidity_2m[i],
    windSpeed: windspeed_10m[i],
  })).filter((h) => h.hour % 3 === 0)

  return JSON.stringify({
    latitude: lat,
    longitude: lng,
    forecast: hourly,
  })
}
