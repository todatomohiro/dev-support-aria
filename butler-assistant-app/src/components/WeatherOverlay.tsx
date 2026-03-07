import type { ReactNode } from 'react'
import type { WeatherInfo } from '@/hooks/useWeatherIcon'

interface WeatherOverlayProps {
  weather: WeatherInfo
}

/**
 * 天気アイコン + 気温オーバーレイ
 *
 * Live2D キャンバスの左上に表示する。
 * WMO 天気コードに応じた SVG アイコンと気温を表示。
 */
export function WeatherOverlay({ weather }: WeatherOverlayProps) {
  const icon = getWeatherIcon(weather.code, weather.isDay)

  return (
    <div
      className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-xl bg-black/30 backdrop-blur-sm pointer-events-none select-none z-10"
      data-testid="weather-overlay"
    >
      <svg
        className="w-7 h-7 text-white/90"
        viewBox="0 0 32 32"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {icon}
      </svg>
      <span className="text-white/90 text-xs font-medium tabular-nums">
        {weather.temperature}°C
      </span>
    </div>
  )
}

/**
 * WMO 天気コードに対応する SVG パスを返す
 */
function getWeatherIcon(code: number, isDay: boolean): ReactNode {
  // 快晴
  if (code === 0) {
    return isDay ? <SunIcon /> : <MoonIcon />
  }
  // 晴れ（薄曇り）
  if (code === 1) {
    return isDay ? <SunCloudIcon /> : <MoonCloudIcon />
  }
  // 曇り
  if (code === 2 || code === 3) {
    return <CloudIcon />
  }
  // 霧
  if (code === 45 || code === 48) {
    return <FogIcon />
  }
  // 霧雨
  if (code >= 51 && code <= 57) {
    return <DrizzleIcon />
  }
  // 雨
  if (code >= 61 && code <= 65) {
    return <RainIcon />
  }
  // 凍雨
  if (code === 66 || code === 67) {
    return <SleetIcon />
  }
  // 雪
  if (code >= 71 && code <= 77) {
    return <SnowIcon />
  }
  // にわか雨
  if (code >= 80 && code <= 82) {
    return <HeavyRainIcon />
  }
  // にわか雪
  if (code === 85 || code === 86) {
    return <HeavySnowIcon />
  }
  // 雷雨
  if (code >= 95 && code <= 99) {
    return <ThunderIcon />
  }
  // フォールバック
  return isDay ? <SunIcon /> : <MoonIcon />
}

/** 太陽 */
function SunIcon() {
  return (
    <>
      <circle cx="16" cy="16" r="5" />
      <line x1="16" y1="3" x2="16" y2="7" />
      <line x1="16" y1="25" x2="16" y2="29" />
      <line x1="3" y1="16" x2="7" y2="16" />
      <line x1="25" y1="16" x2="29" y2="16" />
      <line x1="7.3" y1="7.3" x2="9.8" y2="9.8" />
      <line x1="22.2" y1="22.2" x2="24.7" y2="24.7" />
      <line x1="7.3" y1="24.7" x2="9.8" y2="22.2" />
      <line x1="22.2" y1="9.8" x2="24.7" y2="7.3" />
    </>
  )
}

/** 月 */
function MoonIcon() {
  return (
    <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
  )
}

/** 太陽+雲 */
function SunCloudIcon() {
  return (
    <>
      <circle cx="12" cy="10" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="4.5" y1="10" x2="6.5" y2="10" />
      <line x1="5.6" y1="4.6" x2="7" y2="6" />
      <line x1="18.4" y1="4.6" x2="17" y2="6" />
      <path d="M10 17h14a5 5 0 0 0-1-9.9 7 7 0 0 0-12.9 3.2A4.5 4.5 0 0 0 10 17z" fill="none" />
    </>
  )
}

/** 月+雲 */
function MoonCloudIcon() {
  return (
    <>
      <path d="M15 6.79A5 5 0 1 1 9.21 1a4 4 0 0 0 5.79 5.79z" />
      <path d="M10 17h14a5 5 0 0 0-1-9.9 7 7 0 0 0-12.9 3.2A4.5 4.5 0 0 0 10 17z" fill="none" />
    </>
  )
}

/** 曇り */
function CloudIcon() {
  return (
    <path d="M8 25h16a6 6 0 0 0 0-12 8 8 0 0 0-15.6 3A5.5 5.5 0 0 0 8 25z" fill="none" />
  )
}

/** 霧 */
function FogIcon() {
  return (
    <>
      <path d="M8 18h16a6 6 0 0 0 0-12 8 8 0 0 0-15.6 3A5.5 5.5 0 0 0 8 18z" fill="none" />
      <line x1="6" y1="22" x2="26" y2="22" />
      <line x1="8" y1="26" x2="24" y2="26" />
      <line x1="10" y1="30" x2="22" y2="30" />
    </>
  )
}

/** 霧雨（小雨） */
function DrizzleIcon() {
  return (
    <>
      <path d="M8 20h16a6 6 0 0 0 0-12 8 8 0 0 0-15.6 3A5.5 5.5 0 0 0 8 20z" fill="none" />
      <line x1="12" y1="24" x2="12" y2="26" />
      <line x1="20" y1="24" x2="20" y2="26" />
      <line x1="16" y1="27" x2="16" y2="29" />
    </>
  )
}

/** 雨 */
function RainIcon() {
  return (
    <>
      <path d="M8 19h16a6 6 0 0 0 0-12 8 8 0 0 0-15.6 3A5.5 5.5 0 0 0 8 19z" fill="none" />
      <line x1="10" y1="23" x2="9" y2="27" />
      <line x1="16" y1="23" x2="15" y2="27" />
      <line x1="22" y1="23" x2="21" y2="27" />
    </>
  )
}

/** にわか雨（強い雨） */
function HeavyRainIcon() {
  return (
    <>
      <path d="M8 18h16a6 6 0 0 0 0-12 8 8 0 0 0-15.6 3A5.5 5.5 0 0 0 8 18z" fill="none" />
      <line x1="9" y1="22" x2="7" y2="28" />
      <line x1="15" y1="22" x2="13" y2="28" />
      <line x1="21" y1="22" x2="19" y2="28" />
      <line x1="25" y1="22" x2="23" y2="28" />
    </>
  )
}

/** みぞれ（凍雨） */
function SleetIcon() {
  return (
    <>
      <path d="M8 19h16a6 6 0 0 0 0-12 8 8 0 0 0-15.6 3A5.5 5.5 0 0 0 8 19z" fill="none" />
      <line x1="10" y1="23" x2="9" y2="26" />
      <line x1="22" y1="23" x2="21" y2="26" />
      <circle cx="16" cy="26" r="1.5" fill="currentColor" stroke="none" />
    </>
  )
}

/** 雪 */
function SnowIcon() {
  return (
    <>
      <path d="M8 19h16a6 6 0 0 0 0-12 8 8 0 0 0-15.6 3A5.5 5.5 0 0 0 8 19z" fill="none" />
      <circle cx="10" cy="25" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="16" cy="24" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="22" cy="25" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="13" cy="28" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="19" cy="28" r="1.2" fill="currentColor" stroke="none" />
    </>
  )
}

/** 強い雪 */
function HeavySnowIcon() {
  return (
    <>
      <path d="M8 18h16a6 6 0 0 0 0-12 8 8 0 0 0-15.6 3A5.5 5.5 0 0 0 8 18z" fill="none" />
      <circle cx="9" cy="23" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="22" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="21" cy="23" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="26" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="26" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="24" cy="26" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="10" cy="29" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="16" cy="29" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="22" cy="29" r="1.2" fill="currentColor" stroke="none" />
    </>
  )
}

/** 雷雨 */
function ThunderIcon() {
  return (
    <>
      <path d="M8 18h16a6 6 0 0 0 0-12 8 8 0 0 0-15.6 3A5.5 5.5 0 0 0 8 18z" fill="none" />
      <polyline points="17,20 14,25 18,25 15,30" />
    </>
  )
}
