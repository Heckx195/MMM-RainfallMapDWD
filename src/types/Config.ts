export interface Config {
  animationSpeedMs: number
  colorizeTime: boolean
  defaultZoomLevel: number
  displayClockSymbol: boolean
  displayTime: boolean
  displayTimeline: boolean
  displayHoursBeforeRain: number
  substituteModules?: string[]
  substitudeModules?: string[]
  extraDelayLastFrameMs: number
  extraDelayCurrentFrameMs: number
  invertColors: boolean
  markers: Marker[]
  mapPositions: MapPosition[]
  mapUrl: string
  mapHeight: string
  mapWidth: string
  maxHistoryFrames: number
  maxForecastFrames: number
  timeFormat: number
  timezone: string | null
  /** Minutes between DWD radar polls; must be a positive multiple of 5 (DWD's native product interval). */
  pollingIntervalMinutes: number
  /** Width, in pixels, of the reprojected radar overlay rendered by node_helper (independent of mapWidth/mapHeight - see README). */
  radarRasterWidth: number
  /** Height, in pixels, of the reprojected radar overlay rendered by node_helper (independent of mapWidth/mapHeight - see README). */
  radarRasterHeight: number
  /** Color ramp used by node_helper to render precipitation intensity. */
  radarColorScheme: 'blue' | 'classic' | 'violet' | 'dwd'
}

export interface Marker {
  lat: number
  lng: number
  color?: string
  size?: 'normal' | '2x'
}

interface MapPosition {
  lat: number
  lng: number
  zoom: number
  loops?: number
}
