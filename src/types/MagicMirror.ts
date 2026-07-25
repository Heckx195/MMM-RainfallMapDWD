/**
 * Type definitions for MagicMirror global objects
 */

export interface MMModule {
  name: string
  hidden: boolean
  hide(speed?: number, callback?: () => void, options?: { lockString?: string }): void
  show(speed?: number, callback?: () => void, options?: { lockString?: string }): void
}

export interface MMModules {
  enumerate(callback: (module: MMModule) => void): void
  find(predicate: (module: MMModule) => boolean): MMModule | undefined
}

export interface MMGlobal {
  getModules(): MMModules
}

export interface WeatherPayload {
  current?: {
    weather?: { icon: string }[]
  }
  type?: string
  hourlyArray?: HourlyWeatherEntry[]
}

export interface HourlyWeatherEntry {
  date: number
  weatherType: string
}

export interface CurrentWeatherPayload {
  type: string
}

export interface OpenWeatherPayload {
  current?: {
    weather?: { icon: string }[]
  }
}

export interface DwdRadarFrame {
  time: number
  fileName: string
}

export interface DwdRadarFramesPayload {
  identifier: string
  bounds: { south: number; west: number; north: number; east: number } | null
  history: DwdRadarFrame[]
  forecast: DwdRadarFrame[]
}
