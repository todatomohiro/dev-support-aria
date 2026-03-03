import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGeolocation } from '../useGeolocation'

/** navigator.geolocation のモック */
function mockGeolocation(mode: 'success' | 'denied' | 'timeout' | 'unavailable' | 'none') {
  if (mode === 'none') {
    Object.defineProperty(navigator, 'geolocation', {
      value: undefined,
      writable: true,
      configurable: true,
    })
    return
  }

  const getCurrentPosition = vi.fn(
    (success: PositionCallback, error: PositionErrorCallback) => {
      if (mode === 'success') {
        success({
          coords: { latitude: 35.6812, longitude: 139.7671 },
          timestamp: Date.now(),
        } as GeolocationPosition)
      } else {
        const codeMap = { denied: 1, unavailable: 2, timeout: 3 } as const
        error({
          code: codeMap[mode],
          message: mode,
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        } as GeolocationPositionError)
      }
    }
  )

  Object.defineProperty(navigator, 'geolocation', {
    value: { getCurrentPosition },
    writable: true,
    configurable: true,
  })

  return { getCurrentPosition }
}

describe('useGeolocation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'geolocation', {
      value: undefined,
      writable: true,
      configurable: true,
    })
  })

  it('初期状態は location が null で loading が false', () => {
    mockGeolocation('success')
    const { result } = renderHook(() => useGeolocation())

    expect(result.current.location).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('requestLocation 成功時に location が設定される', () => {
    mockGeolocation('success')
    const { result } = renderHook(() => useGeolocation())

    act(() => {
      result.current.requestLocation()
    })

    expect(result.current.location).toEqual({ lat: 35.6812, lng: 139.7671 })
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('パーミッション拒否時にエラーが設定される', () => {
    mockGeolocation('denied')
    const { result } = renderHook(() => useGeolocation())

    act(() => {
      result.current.requestLocation()
    })

    expect(result.current.location).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe('位置情報の使用が許可されていません')
  })

  it('タイムアウト時にエラーが設定される', () => {
    mockGeolocation('timeout')
    const { result } = renderHook(() => useGeolocation())

    act(() => {
      result.current.requestLocation()
    })

    expect(result.current.location).toBeNull()
    expect(result.current.error).toBe('位置情報の取得がタイムアウトしました')
  })

  it('位置情報が取得できない場合にエラーが設定される', () => {
    mockGeolocation('unavailable')
    const { result } = renderHook(() => useGeolocation())

    act(() => {
      result.current.requestLocation()
    })

    expect(result.current.location).toBeNull()
    expect(result.current.error).toBe('位置情報を取得できませんでした')
  })

  it('geolocation API 非対応ブラウザではエラーが設定される', () => {
    mockGeolocation('none')
    const { result } = renderHook(() => useGeolocation())

    act(() => {
      result.current.requestLocation()
    })

    expect(result.current.location).toBeNull()
    expect(result.current.error).toBe('このブラウザは位置情報に対応していません')
  })

  it('clearLocation で位置情報とエラーがクリアされる', () => {
    mockGeolocation('success')
    const { result } = renderHook(() => useGeolocation())

    act(() => {
      result.current.requestLocation()
    })
    expect(result.current.location).not.toBeNull()

    act(() => {
      result.current.clearLocation()
    })

    expect(result.current.location).toBeNull()
    expect(result.current.error).toBeNull()
  })
})
