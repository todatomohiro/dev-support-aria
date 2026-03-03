import { useState, useCallback } from 'react'
import type { UserLocation } from '@/types'

/** useGeolocation の戻り値 */
export interface UseGeolocationResult {
  /** 現在地 */
  location: UserLocation | null
  /** 取得中かどうか */
  loading: boolean
  /** エラーメッセージ */
  error: string | null
  /** 位置情報を取得 */
  requestLocation: () => void
  /** 位置情報をクリア */
  clearLocation: () => void
}

/** 位置情報取得のタイムアウト（ミリ秒） */
const GEOLOCATION_TIMEOUT = 10000

/**
 * GPS 位置情報取得カスタムフック
 *
 * navigator.geolocation.getCurrentPosition() を使用して現在地を取得する。
 * Web / Capacitor WebView / Tauri WebView 共通で動作する。
 */
export function useGeolocation(): UseGeolocationResult {
  const [location, setLocation] = useState<UserLocation | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 位置情報を取得 */
  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError('このブラウザは位置情報に対応していません')
      return
    }

    setLoading(true)
    setError(null)

    console.log('[Geolocation] 位置情報を取得中...')

    navigator.geolocation.getCurrentPosition(
      (position) => {
        console.log(`[Geolocation] 取得成功: lat=${position.coords.latitude}, lng=${position.coords.longitude}`)
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        })
        setLoading(false)
      },
      (err) => {
        let msg: string
        switch (err.code) {
          case err.PERMISSION_DENIED:
            msg = '位置情報の使用が許可されていません'
            break
          case err.POSITION_UNAVAILABLE:
            msg = '位置情報を取得できませんでした'
            break
          case err.TIMEOUT:
            msg = '位置情報の取得がタイムアウトしました'
            break
          default:
            msg = '位置情報の取得に失敗しました'
        }
        console.warn(`[Geolocation] エラー: code=${err.code}, msg=${msg}`)
        setError(msg)
        setLoading(false)
      },
      {
        enableHighAccuracy: true,
        timeout: GEOLOCATION_TIMEOUT,
        maximumAge: 60000,
      }
    )
  }, [])

  /** 位置情報をクリア */
  const clearLocation = useCallback(() => {
    setLocation(null)
    setError(null)
  }, [])

  return { location, loading, error, requestLocation, clearLocation }
}
