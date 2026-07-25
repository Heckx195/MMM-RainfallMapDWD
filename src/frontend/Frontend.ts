import * as L from 'leaflet'
import * as Log from 'logger'
import { changeSubstituteModuleVisibility, getIconColor, rainConditions } from './Utils'
import { Config } from '../types/Config'
import {
  WeatherPayload,
  CurrentWeatherPayload,
  OpenWeatherPayload,
  DwdRadarFramesPayload,
  DwdRadarFrame
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
    isHiddenDueToNoRain: false
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
      L.marker([marker.lat, marker.lng], {
        icon: new L.Icon({
          iconUrl: this.file(`img/marker-icon-2x-${getIconColor(marker)}.png`),
          shadowUrl: this.file(`img/marker-shadow.png`),
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          shadowSize: [41, 41],
          shadowAnchor: [12, 41]
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

    // Rebuild all overlay layers from scratch - simpler and less error-prone
    // than reconciling against the previous set, and cheap enough to redo
    // every poll cycle (every few minutes).
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

    this.runtimeData.animationPosition = 0

    if (this.config.displayTimeline && this.runtimeData.timeframes.length > 0) {
      this.runtimeData.percentPerFrame = 100 / (this.runtimeData.numHistoryFrames + this.runtimeData.numForecastFrames)
      const historyPart = (this.runtimeData.numHistoryFrames - 1) * this.runtimeData.percentPerFrame
      const forecastPart = this.runtimeData.numForecastFrames * this.runtimeData.percentPerFrame
      this.runtimeData.timelineDiv.style.background = `linear-gradient(to right, var(--color-history) 0% ${historyPart}%, var(--color-now) ${historyPart}% ${
        historyPart + this.runtimeData.percentPerFrame
      }%, var(--color-forecast) ${forecastPart}%)`
    }

    // Show the first frame immediately - otherwise it stays invisible until the
    // animation wraps back around to it, since tick() only ever reveals the
    // *next* frame relative to animationPosition.
    const firstFrame = this.runtimeData.timeframes[0]
    if (firstFrame) {
      const firstLayer = this.runtimeData.radarLayers.get(firstFrame.time)
      if (firstLayer) {
        firstLayer.setOpacity(1)
      }
      this.updateTimeDisplay(firstFrame, 0)
    }
  },

  suspend() {
    // Clear animation timer
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

  socketNotificationReceived(notification: string, payload: DwdRadarFramesPayload) {
    if (notification === 'DWD_RADAR_FRAMES' && payload.identifier === this.identifier) {
      this.applyFrames(payload)
    }
  },

  notificationReceived(
    notificationIdentifier: string,
    payload: WeatherPayload | CurrentWeatherPayload | OpenWeatherPayload
  ) {
    if (this.config.displayHoursBeforeRain >= 0) {
      if (notificationIdentifier === 'DOM_OBJECTS_CREATED') {
        changeSubstituteModuleVisibility(false, this.config)
      }
      if (this.config.displayHoursBeforeRain === 0) {
        if (notificationIdentifier === 'OPENWEATHER_FORECAST_WEATHER_UPDATE') {
          const currentCondition = (payload as OpenWeatherPayload).current?.weather?.[0]?.icon
          this.handleCurrentWeatherCondition(currentCondition)
        } else if (notificationIdentifier === 'CURRENTWEATHER_TYPE') {
          const currentCondition = (payload as CurrentWeatherPayload).type
          this.handleCurrentWeatherCondition(currentCondition)
        }
      } else if (this.config.displayHoursBeforeRain > 0) {
        if (notificationIdentifier === 'WEATHER_UPDATED') {
          this.handleWeatherUpdate(payload as WeatherPayload)
        }
      }
    }
  },

  handleWeatherUpdate(update: WeatherPayload) {
    const hourlyData = update.hourlyArray
    if (!hourlyData) {
      return
    }
    let closestRain = Infinity
    const now = Date.now()
    for (const entry of hourlyData) {
      if (rainConditions.some((condition) => entry.weatherType.includes(condition))) {
        if (entry.date - now < closestRain) {
          closestRain = entry.date - now
        }
      }
    }
    closestRain = closestRain / 1000 / 60 / 60 // convert to hours
    Log.log('Next rain will be in %.1f hours.', closestRain)
    if (closestRain < this.config.displayHoursBeforeRain) {
      this.handleCurrentWeatherCondition('rain')
    } else {
      this.handleCurrentWeatherCondition('')
    }
  },

  handleCurrentWeatherCondition(currentCondition: string) {
    if (currentCondition && rainConditions.some((condition) => currentCondition.includes(condition))) {
      // Rain detected - show module if it was hidden due to no rain
      if (this.runtimeData.isHiddenDueToNoRain) {
        this.runtimeData.isHiddenDueToNoRain = false
        changeSubstituteModuleVisibility(false, this.config)
        this.show(300, undefined, { lockString: this.identifier })
        // Restart animation if not running
        if (!this.runtimeData.animationTimer) {
          this.play()
        }
      }
    } else {
      // No rain - hide module if currently shown
      if (!this.runtimeData.isHiddenDueToNoRain) {
        this.runtimeData.isHiddenDueToNoRain = true
        this.hide(300, undefined, { lockString: this.identifier })
        // Stop animation to save resources
        if (this.runtimeData.animationTimer) {
          clearTimeout(this.runtimeData.animationTimer)
          this.runtimeData.animationTimer = null
        }
        changeSubstituteModuleVisibility(true, this.config)
      }
    }
  }
})
