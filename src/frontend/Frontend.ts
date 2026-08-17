import * as L from 'leaflet'
import * as Log from 'logger'
import { changeSubstituteModuleVisibility, getIconColor, getIconSize, rainConditions } from './Utils'
import { Config } from '../types/Config'
import {
  WeatherPayload,
  CurrentWeatherPayload,
  OpenWeatherPayload,
  DwdRadarFramesPayload,
  DwdRadarFrame,
  DwdRainForecastPayload,
  NotificationSender
} from '../types/MagicMirror'

// Global or injected variable declarations

Module.register<Config>('MMM-RainfallMapDWD', {
  defaults: {
    animationSpeedMs: 800,
    colorizeTime: true,
    defaultZoomLevel: 6,
    displayClockSymbol: true,
    displayTime: true,
    displayTimeline: true,
    displayHoursBeforeRain: -1,
    invertColors: false,
    substituteModules: [],
    substitudeModules: [], // Deprecated - will be removed in future versions, use substituteModules instead.
    extraDelayLastFrameMs: 2000,
    extraDelayCurrentFrameMs: 5000,
    markers: [
      { lat: 49.41, lng: 8.717, color: 'red' },
      { lat: 48.856, lng: 2.35, color: 'green' }
    ],
    mapPositions: [
      { lat: 49.41, lng: 8.717, zoom: 7, loops: 1 },
      { lat: 49.41, lng: 8.717, zoom: 5, loops: 2 },
      { lat: 48.856, lng: 2.35, zoom: 5, loops: 1 },
      { lat: 48.856, lng: 2.35, zoom: 7, loops: 2 },
      { lat: 49.15, lng: 6.154, zoom: 4, loops: 2 }
    ],

    mapUrl: 'https://a.tile.openstreetmap.de/{z}/{x}/{y}.png',
    mapHeight: '420px',
    mapWidth: '420px',
    maxHistoryFrames: 6,
    maxForecastFrames: -1,
    timeFormat: config.timeFormat || 24,
    timezone: null,
    pollingIntervalMinutes: 5,
    radarRasterWidth: 800,
    radarRasterHeight: 873,
    radarColorScheme: 'blue'
  },

  /**
   * Runtime state for the rain map animation.
   * @property {number} animationPosition - Current frame index in animation
   * @property {number|null} animationTimer - setTimeout ID for animation loop
   * @property {L.Map|null} map - Leaflet map instance
   * @property {number} mapPosition - Current index in mapPositions array
   * @property {number} numHistoryFrames - Number of past radar frames
   * @property {number} numForecastFrames - Number of future radar frames
   * @property {number} loopNumber - Current loop count for position cycling
   * @property {Map<number, L.ImageOverlay>|null} radarLayers - Radar image overlays keyed by timestamp
   * @property {HTMLSpanElement|null} timeDiv - Time display element
   * @property {HTMLSpanElement} [sliderDiv] - Timeline slider element
   * @property {HTMLSpanElement} [timelineDiv] - Timeline background element
   * @property {Array<{time: number, fileName: string}>} timeframes - Radar frame data from node_helper
   * @property {number} [percentPerFrame] - Timeline percentage per frame
   * @property {boolean} isHiddenDueToNoRain - Tracks if module is hidden because no rain is expected
   * @property {number|null|undefined} dwdRainMinutes - Minutes until rain at forecast location per DWD nowcast.
   *   undefined = no DWD forecast received yet; null = no rain within 120-min window; 0 = raining now.
   */
  runtimeData: {
    animationPosition: 0,
    animationTimer: null,
    map: null,
    mapPosition: 0,
    numHistoryFrames: 0,
    numForecastFrames: 0,
    loopNumber: 1,
    radarLayers: null,
    timeDiv: null,
    timeframes: [],
    isHiddenDueToNoRain: false,
    /** Minutes until rain per DWD radar (undefined=no data, null=no rain in 2h, 0=raining now, N=minutes) */
    dwdRainMinutes: undefined as number | null | undefined,
    /** Hours until next rain from hourly weather module, only for entries beyond 120 min (undefined=no data) */
    hourlyRainHours: undefined as number | undefined
  },

  getStyles() {
    return ['font-awesome.css', 'leaflet.css', 'MMM-RainfallMapDWD.css']
  },

  getDom() {
    // Create app-wrapper
    const app = document.createElement('div')
    app.classList.add('rain-map-wrapper')
    if (this.config.invertColors) {
      app.classList.add('inverted-colors')
    }

    // Create time-wrapper
    if (this.config.displayTime) {
      const timeWrapperDiv = document.createElement('div')
      timeWrapperDiv.classList.add('rain-map-time-wrapper')
      timeWrapperDiv.innerHTML = `${this.config.displayClockSymbol ? "<i class='fas fa-clock'></i>" : ''}`
      this.runtimeData.timeDiv = document.createElement('span')
      this.runtimeData.timeDiv.classList.add('rain-map-time')
      timeWrapperDiv.appendChild(this.runtimeData.timeDiv)

      if (this.config.displayTimeline) {
        const timelineWrapper = document.createElement('span')
        timelineWrapper.classList.add('rain-map-timeline-wrapper')

        this.runtimeData.sliderDiv = document.createElement('span')
        this.runtimeData.sliderDiv.classList.add('rain-map-timeslider')
        timelineWrapper.appendChild(this.runtimeData.sliderDiv)
        this.runtimeData.timelineDiv = document.createElement('span')
        this.runtimeData.timelineDiv.classList.add('rain-map-timeline')
        timelineWrapper.appendChild(this.runtimeData.timelineDiv)

        timeWrapperDiv.appendChild(timelineWrapper)
      }

      app.appendChild(timeWrapperDiv)
    }

    // Create map
    const mapDiv = document.createElement('div')
    mapDiv.style.height = this.config.mapHeight
    mapDiv.style.width = this.config.mapWidth
    app.appendChild(mapDiv)

    // Temporary add app-wrapper to body, otherwise leaflet won't initialize correctly
    document.body.appendChild(app)

    const firstPosition = this.config.mapPositions[0]

    this.runtimeData.map = L.map(mapDiv, {
      zoomControl: false,
      trackResize: false,
      attributionControl: false
    }).setView([firstPosition.lat, firstPosition.lng], firstPosition.zoom)

    // Sanitize map URL
    L.tileLayer(this.config.mapUrl.split('$').join('')).addTo(this.runtimeData.map)

    for (const marker of this.config.markers) {
      const is2x = getIconSize(marker) === '2x'
      const iconFilePrefix = is2x ? 'marker-icon-2x' : 'marker-icon'
      // marker-shadow.png only ships in one resolution, stretched to match at 2x size.
      const [iconWidth, iconHeight] = is2x ? [50, 82] : [25, 41]

      L.marker([marker.lat, marker.lng], {
        icon: new L.Icon({
          iconUrl: this.file(`img/${iconFilePrefix}-${getIconColor(marker)}.png`),
          shadowUrl: this.file(`img/marker-shadow.png`),
          iconSize: [iconWidth, iconHeight],
          iconAnchor: [iconWidth / 2, iconHeight],
          shadowSize: [iconHeight, iconHeight],
          shadowAnchor: [iconWidth / 2, iconHeight]
        })
      }).addTo(this.runtimeData.map)
    }

    // Once the map is initialized, we can remove the app-wrapper from the body and return it to the getDom() function
    document.body.removeChild(app)

    return app
  },

  start() {
    this.runtimeData.radarLayers = new Map()

    if ((this.config.substitudeModules?.length || 0) > 0 && (this.config.substituteModules?.length || 0) === 0) {
      Log.warn(
        'MMM-RainfallMapDWD: config key "substitudeModules" is deprecated. Please use "substituteModules" instead.'
      )
    }
    if ((this.config.substitudeModules?.length || 0) > 0 && (this.config.substituteModules?.length || 0) > 0) {
      Log.warn(
        'MMM-RainfallMapDWD: Both "substituteModules" and deprecated "substitudeModules" are set. Using "substituteModules".'
      )
    }

    this.sendSocketNotification('DWD_RADAR_CONFIGURE', { identifier: this.identifier, config: this.config })
    this.play()
  },

  play() {
    // Clear any existing timer to prevent multiple timers running in parallel
    // (can happen when module is shown/hidden by carousel)
    if (this.runtimeData.animationTimer) {
      clearTimeout(this.runtimeData.animationTimer)
    }

    let extraDelay = 0
    if (this.runtimeData.animationPosition === this.runtimeData.timeframes.length - 1) {
      extraDelay = this.config.extraDelayLastFrameMs
    } else if (this.runtimeData.animationPosition === this.runtimeData.numHistoryFrames - 1) {
      extraDelay = this.config.extraDelayCurrentFrameMs
    }

    this.runtimeData.animationTimer = setTimeout(() => {
      this.tick()
      this.play()
    }, this.config.animationSpeedMs + extraDelay)
  },

  tick() {
    if (!this.runtimeData.map || this.runtimeData.timeframes.length === 0) {
      return
    }

    const nextAnimationPosition =
      this.runtimeData.animationPosition < this.runtimeData.timeframes.length - 1
        ? this.runtimeData.animationPosition + 1
        : 0

    // Manage map positions
    if (nextAnimationPosition === 0 && this.config.mapPositions.length > 1) {
      const currentMapPosition = this.config.mapPositions[this.runtimeData.mapPosition]

      if (this.runtimeData.loopNumber === (currentMapPosition.loops || 1)) {
        this.runtimeData.loopNumber = 1
        const nextMapPosition =
          this.runtimeData.mapPosition === this.config.mapPositions.length - 1 ? 0 : this.runtimeData.mapPosition + 1
        this.runtimeData.mapPosition = nextMapPosition
        const nextPosition = this.config.mapPositions[nextMapPosition]
        this.runtimeData.map.setView(
          new L.LatLng(nextPosition.lat, nextPosition.lng),
          nextPosition.zoom || this.config.defaultZoomLevel,
          {
            animation: false
          }
        )
      } else {
        this.runtimeData.loopNumber += 1
      }
    }

    // Manage radar layers
    const currentTimeframe = this.runtimeData.timeframes[this.runtimeData.animationPosition]
    const currentRadarLayer = this.runtimeData.radarLayers.get(currentTimeframe.time)

    const nextTimeframe = this.runtimeData.timeframes[nextAnimationPosition]
    const nextRadarLayer = this.runtimeData.radarLayers.get(nextTimeframe.time)

    if (nextRadarLayer) {
      nextRadarLayer.setOpacity(1)
    }
    if (currentRadarLayer) {
      currentRadarLayer.setOpacity(0.001)
    }

    this.updateTimeDisplay(nextTimeframe, nextAnimationPosition)
    this.runtimeData.animationPosition = nextAnimationPosition
  },

  updateTimeDisplay(timeframe: DwdRadarFrame, position: number) {
    if (!this.config.displayTime) {
      return
    }

    const date = new Date(timeframe.time * 1000)
    const timeString = date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: this.config.timeFormat !== 24,
      timeZone: this.config.timezone || undefined
    })
    this.runtimeData.timeDiv.innerHTML = timeString

    if (this.config.colorizeTime) {
      if (position < this.runtimeData.numHistoryFrames - 1) {
        this.runtimeData.timeDiv.classList = 'rain-map-time rain-map-history'
      } else if (position === this.runtimeData.numHistoryFrames - 1) {
        this.runtimeData.timeDiv.classList = 'rain-map-time rain-map-now'
      } else {
        this.runtimeData.timeDiv.classList = 'rain-map-time rain-map-forecast'
      }
    }

    if (this.config.displayTimeline) {
      this.runtimeData.sliderDiv.style.left = `${this.runtimeData.percentPerFrame * position}%`
    }
  },

  applyFrames(payload: DwdRadarFramesPayload) {
    if (!this.runtimeData.map || !payload.bounds) {
      return
    }

    const bounds = new L.LatLngBounds(
      [payload.bounds.south, payload.bounds.west],
      [payload.bounds.north, payload.bounds.east]
    )

    // Used to find the correct animationPosition after a rebuild of an updated frame set.
    const currentTime = this.runtimeData.timeframes[this.runtimeData.animationPosition]?.time

    // Rebuild all overlay layers from scratch (simpler, less error-prone - could be optimized).
    for (const layer of this.runtimeData.radarLayers.values()) {
      this.runtimeData.map.removeLayer(layer)
    }
    this.runtimeData.radarLayers.clear()

    this.runtimeData.timeframes = [...payload.history, ...payload.forecast]
    this.runtimeData.numHistoryFrames = payload.history.length
    this.runtimeData.numForecastFrames = payload.forecast.length

    for (const frame of this.runtimeData.timeframes) {
      const layer = L.imageOverlay(this.file(`cache/${this.identifier}/${frame.fileName}`), bounds, {
        opacity: 0.001
      })
      layer.addTo(this.runtimeData.map)
      this.runtimeData.radarLayers.set(frame.time, layer)
    }

    // Resume at the same timestamp if it still exists in the new frame set.
    const preservedPosition = this.runtimeData.timeframes.findIndex(
      (frame: DwdRadarFrame) => frame.time === currentTime
    )
    this.runtimeData.animationPosition = preservedPosition >= 0 ? preservedPosition : 0

    if (this.config.displayTimeline && this.runtimeData.timeframes.length > 0) {
      this.runtimeData.percentPerFrame = 100 / (this.runtimeData.numHistoryFrames + this.runtimeData.numForecastFrames)
      const historyPart = (this.runtimeData.numHistoryFrames - 1) * this.runtimeData.percentPerFrame
      const forecastPart = this.runtimeData.numForecastFrames * this.runtimeData.percentPerFrame
      this.runtimeData.timelineDiv.style.background = `linear-gradient(to right, var(--color-history) 0% ${historyPart}%, var(--color-now) ${historyPart}% ${
        historyPart + this.runtimeData.percentPerFrame
      }%, var(--color-forecast) ${forecastPart}%)`
    }

    // Show the current frame immediately.
    const currentFrame = this.runtimeData.timeframes[this.runtimeData.animationPosition]
    if (currentFrame) {
      const currentLayer = this.runtimeData.radarLayers.get(currentFrame.time)
      if (currentLayer) {
        currentLayer.setOpacity(1)
      }
      this.updateTimeDisplay(currentFrame, this.runtimeData.animationPosition)
    }
  },

  suspend() {
    // Clear animation timer.
    if (this.runtimeData.animationTimer) {
      clearTimeout(this.runtimeData.animationTimer)
      this.runtimeData.animationTimer = null
    }
  },

  resume() {
    // Restart animation. The DWD polling cycle in node_helper keeps running
    // independently of module visibility, so no data re-fetch is needed here.
    this.play()
  },

  socketNotificationReceived(notification: string, payload: DwdRadarFramesPayload | DwdRainForecastPayload) {
    if (notification === 'DWD_RADAR_FRAMES' && (payload as DwdRadarFramesPayload).identifier === this.identifier) {
      this.applyFrames(payload as DwdRadarFramesPayload)
    }
    if (notification === 'DWD_RAIN_FORECAST' && (payload as DwdRainForecastPayload).identifier === this.identifier) {
      this.handleDwdRainForecast(payload as DwdRainForecastPayload)
    }
  },

  notificationReceived(
    notificationIdentifier: string,
    payload: WeatherPayload | CurrentWeatherPayload | OpenWeatherPayload,
    sender?: NotificationSender
  ) {
    if (this.config.displayHoursBeforeRain >= 0) {
      if (notificationIdentifier === 'DOM_OBJECTS_CREATED') {
        changeSubstituteModuleVisibility(false, this.config, this.identifier)
      }
      if (this.config.displayHoursBeforeRain === 0) {
        // DWD nowcast (lead=0 analysis frame) is more accurate than model-based weather modules
        // for detecting current rain. Only fall back to the weather module when DWD has not yet
        // provided data for this location (e.g., outside coverage or no location configured).
        if (this.runtimeData.dwdRainMinutes === undefined) {
          if (notificationIdentifier === 'OPENWEATHER_FORECAST_WEATHER_UPDATE') {
            const currentCondition = (payload as OpenWeatherPayload).current?.weather?.[0]?.icon
            this.handleCurrentWeatherCondition(currentCondition)
          } else if (notificationIdentifier === 'CURRENTWEATHER_TYPE') {
            const currentCondition = (payload as CurrentWeatherPayload).type
            this.handleCurrentWeatherCondition(currentCondition)
          }
        }
      } else if (this.config.displayHoursBeforeRain > 0) {
        // If multiple "weather" module instances are configured, take only the hourly one.
        if (
          notificationIdentifier === 'WEATHER_UPDATED' &&
          (!sender?.config?.type || sender.config.type === 'hourly')
        ) {
          this.handleWeatherUpdate(payload as WeatherPayload)
        }
      }
    }
  },

  // Log both in the renderer DevTools console and forwarded to node_helper (stdout)
  logDecision(level: 'log' | 'info' | 'warn' | 'error', message: string) {
    Log[level](message)
    this.sendSocketNotification('DWD_FRONTEND_LOG', { level, message })
  },

  handleDwdRainForecast(forecast: DwdRainForecastPayload) {
    if (this.config.displayHoursBeforeRain < 0) return
    // Location outside DWD radar coverage: fall back to the weather module entirely
    if (forecast.locationOutsideCoverage) return

    this.runtimeData.dwdRainMinutes = forecast.minutesUntilRain
    this._evaluateVisibility()
  },

  /**
   * Unified show/hide decision that combines DWD nowcast (0–120 min) with the hourly
   * weather module (>120 min). Called whenever either source updates.
   *
   * DWD is the authoritative source for the 0–120 min window: it uses actual radar
   * reflectivity with 5-min resolution, far more precise than hourly model forecasts.
   * The hourly weather module is only consulted for the portion beyond 120 min when
   * displayHoursBeforeRain > 2.
   */
  _evaluateVisibility() {
    const threshold = this.config.displayHoursBeforeRain
    const { dwdRainMinutes, hourlyRainHours } = this.runtimeData
    const thresholdMin = threshold * 60
    // DWD covers at most 120 min regardless of the configured threshold
    const dwdWindowMin = Math.min(thresholdMin, 120)

    // --- DWD check (0 to dwdWindowMin minutes) ---
    if (dwdRainMinutes !== undefined && dwdRainMinutes !== null && dwdRainMinutes <= dwdWindowMin) {
      const reason =
        dwdRainMinutes === 0
          ? 'DWD radar shows rain at forecast location right now'
          : `DWD radar predicts rain in ${dwdRainMinutes} min at forecast location`
      this.handleCurrentWeatherCondition('rain', reason)
      return
    }

    // --- Hourly check for the >2h portion (only when threshold > 2) ---
    if (threshold > 2 && hourlyRainHours !== undefined && hourlyRainHours > 2 && hourlyRainHours < threshold) {
      this.handleCurrentWeatherCondition(
        'rain',
        `hourly forecast: rain in ${hourlyRainHours.toFixed(1)}h (beyond 2h DWD window) is within ${threshold}h threshold`
      )
      return
    }

    // --- No rain found: hide if we have enough data to be confident ---
    // For threshold ≤ 2h: DWD alone is sufficient to decide "no rain → hide".
    // For threshold > 2h: only hide when the hourly module has also confirmed no rain
    //   beyond 2h (otherwise we'd hide prematurely before hourly data arrives).
    const canHide = threshold <= 2 || hourlyRainHours !== undefined
    if (canHide) {
      const dwdText =
        dwdRainMinutes === null ? 'no rain in 120-min DWD window' : `DWD: no rain within ${dwdWindowMin} min`
      this.handleCurrentWeatherCondition('', dwdText)
    }
  },

  handleWeatherUpdate(update: WeatherPayload) {
    const dwdActive = this.runtimeData.dwdRainMinutes !== undefined

    if (!dwdActive) {
      // Without DWD nowcast, use the current weather condition to catch rain that has
      // just started but may not appear in the hourly forecast's upcoming entries yet.
      const currentCondition = update.currentWeather?.weatherType
      if (currentCondition && rainConditions.some((condition) => currentCondition.includes(condition))) {
        this.handleCurrentWeatherCondition(
          'rain',
          `current weather condition is "${currentCondition}" (matches rain), regardless of hourly forecast`
        )
        return
      }
    }

    const hourlyData = update.hourlyArray
    if (!hourlyData) return

    // When DWD nowcast is active, it covers 0-120 min with 5-min resolution.
    // Skip hourly entries within that window so the coarse hourly buckets don't
    // override the precise radar data. Only look at entries beyond 120 min from now.
    // Without DWD: use a -1h tolerance so a current-hour entry counts.
    const minLookAheadMs = dwdActive ? 120 * 60 * 1000 : -60 * 60 * 1000

    let closestRainMs = Infinity
    const now = Date.now()
    for (const entry of hourlyData) {
      if (rainConditions.some((condition) => entry.weatherType.includes(condition))) {
        const timeToRain = entry.date - now
        if (timeToRain >= minLookAheadMs && timeToRain < closestRainMs) {
          closestRainMs = timeToRain
        }
      }
    }
    const hoursToRain = closestRainMs / 1000 / 60 / 60

    if (dwdActive) {
      // Store the hourly result and let _evaluateVisibility combine it with the DWD state
      this.runtimeData.hourlyRainHours = hoursToRain
      this._evaluateVisibility()
    } else {
      // No DWD data: make the decision directly from hourly (original behaviour)
      const threshold = this.config.displayHoursBeforeRain
      if (hoursToRain < threshold) {
        this.handleCurrentWeatherCondition(
          'rain',
          `next rain in ${hoursToRain.toFixed(1)}h is within the configured displayHoursBeforeRain threshold (${threshold}h)`
        )
      } else {
        const closestRainText = Number.isFinite(hoursToRain)
          ? `${hoursToRain.toFixed(1)}h`
          : 'not forecasted in the available data'
        this.handleCurrentWeatherCondition(
          '',
          `next rain (${closestRainText}) is outside the configured displayHoursBeforeRain threshold (${threshold}h)`
        )
      }
    }
  },

  // `reason` is optional and only provided by handleWeatherUpdate, which already knows
  // *why* the condition is what it is (matched current condition vs. hourly forecast
  // threshold). When called directly (displayHoursBeforeRain === 0 path), it falls back
  // to stating the raw currentCondition.
  handleCurrentWeatherCondition(currentCondition: string, reason?: string) {
    const reasonText = reason ?? `currentCondition="${currentCondition || 'none'}"`
    if (currentCondition && rainConditions.some((condition) => currentCondition.includes(condition))) {
      // Rain detected - show module if it was hidden due to no rain
      if (this.runtimeData.isHiddenDueToNoRain) {
        this.logDecision('info', `MMM-RainfallMapDWD: Showing module - ${reasonText}.`)
        this.runtimeData.isHiddenDueToNoRain = false
        changeSubstituteModuleVisibility(false, this.config, this.identifier)
        this.show(300, undefined, { lockString: this.identifier })
        // Restart animation if not running
        if (!this.runtimeData.animationTimer) {
          this.play()
        }
      } else {
        this.logDecision('info', `MMM-RainfallMapDWD: Module stays visible - ${reasonText}.`)
      }
    } else {
      // No rain - hide module if currently shown
      if (!this.runtimeData.isHiddenDueToNoRain) {
        this.logDecision('info', `MMM-RainfallMapDWD: Hiding module - ${reasonText}.`)
        this.runtimeData.isHiddenDueToNoRain = true
        this.hide(300, undefined, { lockString: this.identifier })
        // Stop animation to save resources
        if (this.runtimeData.animationTimer) {
          clearTimeout(this.runtimeData.animationTimer)
          this.runtimeData.animationTimer = null
        }
        changeSubstituteModuleVisibility(true, this.config, this.identifier)
      } else {
        this.logDecision('info', `MMM-RainfallMapDWD: Module stays hidden - ${reasonText}.`)
      }
    }
  }
})
