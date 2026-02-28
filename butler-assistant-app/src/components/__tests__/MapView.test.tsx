import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { MapData } from '@/types'

// Leaflet 関連のモック（vi.mock のファクトリ内で全て定義）
const mocks = vi.hoisted(() => {
  const setView = vi.fn().mockReturnThis()
  const remove = vi.fn()
  const addTo = vi.fn().mockReturnThis()
  const bindPopup = vi.fn().mockReturnThis()
  const markerAddTo = vi.fn().mockReturnValue({ bindPopup })

  return { setView, remove, addTo, bindPopup, markerAddTo }
})

vi.mock('leaflet', () => ({
  default: {
    map: vi.fn(() => ({ setView: mocks.setView, remove: mocks.remove })),
    tileLayer: vi.fn(() => ({ addTo: mocks.addTo })),
    marker: vi.fn(() => ({ addTo: mocks.markerAddTo })),
    Icon: {
      Default: {
        prototype: {},
        mergeOptions: vi.fn(),
      },
    },
  },
}))

vi.mock('leaflet/dist/leaflet.css', () => ({}))
vi.mock('leaflet/dist/images/marker-icon-2x.png', () => ({ default: 'marker-icon-2x.png' }))
vi.mock('leaflet/dist/images/marker-icon.png', () => ({ default: 'marker-icon.png' }))
vi.mock('leaflet/dist/images/marker-shadow.png', () => ({ default: 'marker-shadow.png' }))

// MapView は Leaflet モック設定後にインポート
import { MapView } from '../MapView'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const sampleMapData: MapData = {
  center: { lat: 35.6595, lng: 139.7004 },
  zoom: 15,
  markers: [
    { lat: 35.6595, lng: 139.7004, title: 'テストカフェ', address: '渋谷区1-1-1', rating: 4.2 },
    { lat: 35.6600, lng: 139.7010, title: '別のカフェ', address: '渋谷区2-2-2' },
  ],
}

describe('MapView', () => {
  it('マップコンテナが描画される', () => {
    render(<MapView mapData={sampleMapData} />)
    expect(screen.getByTestId('map-view')).toBeInTheDocument()
  })

  it('Leaflet map が正しい座標とズームで初期化される', async () => {
    const L = (await import('leaflet')).default
    render(<MapView mapData={sampleMapData} />)

    expect(L.map).toHaveBeenCalled()
    expect(mocks.setView).toHaveBeenCalledWith([35.6595, 139.7004], 15)
  })

  it('マーカーが全件生成される', async () => {
    const L = (await import('leaflet')).default
    render(<MapView mapData={sampleMapData} />)

    expect(L.marker).toHaveBeenCalledTimes(2)
    expect(L.marker).toHaveBeenCalledWith([35.6595, 139.7004])
    expect(L.marker).toHaveBeenCalledWith([35.6600, 139.7010])
  })

  it('ポップアップに店名・住所・評価が含まれる', () => {
    render(<MapView mapData={sampleMapData} />)

    expect(mocks.bindPopup).toHaveBeenCalledWith(
      expect.stringContaining('テストカフェ')
    )
    expect(mocks.bindPopup).toHaveBeenCalledWith(
      expect.stringContaining('渋谷区1-1-1')
    )
    expect(mocks.bindPopup).toHaveBeenCalledWith(
      expect.stringContaining('★ 4.2')
    )
  })

  it('アンマウント時にマップが破棄される', () => {
    const { unmount } = render(<MapView mapData={sampleMapData} />)
    unmount()
    expect(mocks.remove).toHaveBeenCalled()
  })
})
