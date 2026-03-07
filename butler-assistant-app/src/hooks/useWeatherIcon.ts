import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '@/stores/appStore'

/** 天気情報 */
export interface WeatherInfo {
  /** WMO 天気コード */
  code: number
  /** 気温（℃） */
  temperature: number
  /** 昼間かどうか */
  isDay: boolean
}

/** Open-Meteo current_weather レスポンス */
interface CurrentWeatherResponse {
  current_weather: {
    weathercode: number
    temperature: number
    is_day: number
  }
}

/** ポーリング間隔: 30分 */
const POLL_INTERVAL_MS = 30 * 60 * 1000

/**
 * 天気アイコン表示用フック
 *
 * ユーザーの現在地をもとに Open-Meteo API から天気情報を取得する。
 * LLM は使用せず、純粋に位置情報ベースで動作する。
 */
export function useWeatherIcon(): WeatherInfo | null {
  const [weather, setWeather] = useState<WeatherInfo | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const fetchWeather = async () => {
      const location = useAppStore.getState().currentLocation
      if (!location) return

      // 前回のリクエストをキャンセル
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lng}&current_weather=true`
        const res = await fetch(url, { signal: controller.signal })
        if (!res.ok) return

        const data: CurrentWeatherResponse = await res.json()
        const cw = data.current_weather

        setWeather({
          code: cw.weathercode,
          temperature: Math.round(cw.temperature),
          isDay: cw.is_day === 1,
        })
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        console.warn('[WeatherIcon] 天気取得エラー:', e)
      }
    }

    // 初回取得
    fetchWeather()

    // ポーリング
    const timer = setInterval(fetchWeather, POLL_INTERVAL_MS)

    // currentLocation の変化を監視
    let prevLoc = useAppStore.getState().currentLocation
    const unsub = useAppStore.subscribe((state) => {
      const loc = state.currentLocation
      if (loc && !prevLoc) {
        fetchWeather()
      }
      prevLoc = loc
    })

    return () => {
      clearInterval(timer)
      unsub()
      abortRef.current?.abort()
    }
  }, [])

  return weather
}
