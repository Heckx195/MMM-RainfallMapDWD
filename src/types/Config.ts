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
  /** Simple CPU-load/sharpness knob: multiplies the default 800x873 raster size (DE1200-grid). Takes precedence over radarRasterWidth/radarRasterHeight when set. */
  radarRasterScale?: number
  /** Advanced: width, in pixels, of the reprojected radar overlay rendered by node_helper (independent of mapWidth/mapHeight - see README). Prefer radarRasterScale unless you need exact control. */
  radarRasterWidth: number
  /** Advanced: height, in pixels, of the reprojected radar overlay rendered by node_helper (independent of mapWidth/mapHeight - see README). Prefer radarRasterScale unless you need exact control. */
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
