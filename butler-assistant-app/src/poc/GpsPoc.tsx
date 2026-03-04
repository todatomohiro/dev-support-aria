import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { useGeolocation } from '@/hooks/useGeolocation'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

/**
 * GPS PoC ページ
 *
 * 端末の GPS 座標を取得しマップ上にピン表示する。
 * LLM に送信される位置情報の精度を目視確認するための検証用。
 */
export function GpsPoc() {
  const navigate = useNavigate()
  const { location, loading, error, requestLocation, clearLocation } = useGeolocation()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  /** マップの表示・更新 */
  useEffect(() => {
    if (!containerRef.current || !location) return

    // 既存マップを破棄
    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
    }

    const map = L.map(containerRef.current).setView([location.lat, location.lng], 16)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)

    // 現在地マーカー
    L.marker([location.lat, location.lng])
      .addTo(map)
      .bindPopup(`<strong>現在地</strong><br>lat: ${location.lat}<br>lng: ${location.lng}`)
      .openPopup()

    // 精度を示す円（半径50m）
    L.circle([location.lat, location.lng], {
      radius: 50,
      color: '#3b82f6',
      fillColor: '#3b82f6',
      fillOpacity: 0.15,
      weight: 1,
    }).addTo(map)

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [location])

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-2xl mx-auto w-full space-y-6">
        {/* ヘッダー */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">GPS PoC</h1>
          <button
            onClick={() => navigate('/poc')}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
          >
            ← PoC 一覧
          </button>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400">
          端末の GPS 座標を取得してマップに表示します。LLM に送信される位置情報の精度を確認できます。
        </p>

        {/* 取得ボタン */}
        <div className="flex gap-3">
          <button
            onClick={requestLocation}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? '取得中...' : '位置情報を取得'}
          </button>
          {location && (
            <button
              onClick={clearLocation}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              クリア
            </button>
          )}
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* 座標情報 */}
        {location && (
          <div className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg space-y-2">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">取得した座標</h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-gray-500 dark:text-gray-400">緯度 (lat):</span>
                <span className="ml-2 font-mono text-gray-900 dark:text-white">{location.lat}</span>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">経度 (lng):</span>
                <span className="ml-2 font-mono text-gray-900 dark:text-white">{location.lng}</span>
              </div>
            </div>
            <div className="text-xs text-gray-400 dark:text-gray-500 pt-1">
              この座標が LLM の search_places に userLocation として渡されます
            </div>
          </div>
        )}

        {/* マップ */}
        {location && (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <div
              ref={containerRef}
              className="w-full h-80"
              data-testid="gps-poc-map"
            />
          </div>
        )}

        {/* 未取得時 */}
        {!location && !loading && !error && (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
            「位置情報を取得」ボタンを押してください
          </div>
        )}
      </div>
    </div>
  )
}
