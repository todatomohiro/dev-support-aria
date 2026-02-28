import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { MapData } from '@/types'

// Leaflet のデフォルトアイコン画像パスを修正（webpack/vite 環境用）
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

delete (L.Icon.Default.prototype as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

interface MapViewProps {
  mapData: MapData
}

/**
 * Leaflet マップ表示コンポーネント
 */
export function MapView({ mapData }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // 既にマップが存在する場合は破棄
    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
    }

    const map = L.map(containerRef.current, {
      scrollWheelZoom: false,
    }).setView([mapData.center.lat, mapData.center.lng], mapData.zoom)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)

    for (const marker of mapData.markers) {
      const popupLines = [`<strong>${marker.title}</strong>`]
      if (marker.address) popupLines.push(marker.address)
      if (marker.rating != null) popupLines.push(`★ ${marker.rating}`)

      L.marker([marker.lat, marker.lng])
        .addTo(map)
        .bindPopup(popupLines.join('<br>'))
    }

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [mapData])

  return (
    <div
      ref={containerRef}
      className="w-full h-48 rounded-md overflow-hidden mt-2"
      data-testid="map-view"
    />
  )
}
