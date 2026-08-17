const path = require('path')
const NodeHelper = require('node_helper')
const Log = require('logger')
const { DwdRvClient } = require('./backend/dwdRvClient')
const { FrameStore } = require('./backend/frameStore')

const MIN_POLLING_INTERVAL_MINUTES = 5

// Reference raster size matching the DE1200 source grid's aspect ratio (1100x1200).
// radarRasterScale, when set, multiplies these instead of using radarRasterWidth/Height directly.
const BASE_RASTER_WIDTH = 800
const BASE_RASTER_HEIGHT = 873

module.exports = NodeHelper.create({
  start() {
    /** @type {Map<string, { client: DwdRvClient, store: FrameStore, timer: NodeJS.Timeout }>} */
    this.instances = new Map()
  },

  stop() {
    for (const { timer } of this.instances.values()) {
      clearInterval(timer)
    }
    this.instances.clear()
  },

  socketNotificationReceived(notification, payload) {
    if (notification === 'DWD_RADAR_CONFIGURE') {
      this._configure(payload.identifier, payload.config)
    } else if (notification === 'DWD_FRONTEND_LOG') {
      // To avoid crashing the backend on a malformed log level, default to 'log' if the level is not recognized.
      const level = typeof Log[payload.level] === 'function' ? payload.level : 'log'
      Log[level](payload.message)
    }
  },

  async _configure(identifier, config) {
    if (this.instances.has(identifier)) {
      // Module was re-initialized (e.g. dev reload); tear down the old timer first.
      clearInterval(this.instances.get(identifier).timer)
      this.instances.delete(identifier)
    }

    let pollingIntervalMinutes = config.pollingIntervalMinutes
    if (
      !Number.isInteger(pollingIntervalMinutes) ||
      pollingIntervalMinutes % MIN_POLLING_INTERVAL_MINUTES !== 0 ||
      pollingIntervalMinutes <= 0
    ) {
      Log.warn(
        `MMM-Regenkarte: pollingIntervalMinutes must be a positive multiple of ${MIN_POLLING_INTERVAL_MINUTES}, got ${pollingIntervalMinutes}. Falling back to ${MIN_POLLING_INTERVAL_MINUTES}.`
      )
      pollingIntervalMinutes = MIN_POLLING_INTERVAL_MINUTES
    }

    // -1 means "all available" for maxHistoryFrames/maxForecastFrames. Since,
    // unlike the original RainViewer-tile approach, every history frame here
    // must be decoded/reprojected/rendered ourselves, "all available" is
    // resolved to a sensible bounded default (2h of history) rather than the
    // full ~48h DWD retains, to keep resource usage predictable.
    const maxHistoryFrames =
      config.maxHistoryFrames === -1 ? Math.round(120 / pollingIntervalMinutes) : config.maxHistoryFrames

    let outWidth = config.radarRasterWidth
    let outHeight = config.radarRasterHeight
    if (typeof config.radarRasterScale === 'number' && config.radarRasterScale > 0) {
      outWidth = Math.round(BASE_RASTER_WIDTH * config.radarRasterScale)
      outHeight = Math.round(BASE_RASTER_HEIGHT * config.radarRasterScale)
    }

    const cacheDir = path.join(this.path, 'cache', identifier)
    const client = new DwdRvClient({
      cacheDir,
      outWidth,
      outHeight,
      colorScheme: config.radarColorScheme,
      log: Log
    })
    const store = new FrameStore(cacheDir, maxHistoryFrames)

    const { targetLat, targetLon } = this._getRainForecastLocation(config)

    const runCycleAndNotify = async () => {
      try {
        const rainForecast = await client.pollCycle(
          store,
          pollingIntervalMinutes,
          config.maxForecastFrames,
          targetLat,
          targetLon
        )
        this._sendSnapshot(identifier, store)
        if (rainForecast !== null) {
          this._sendRainForecast(identifier, rainForecast)
        }
      } catch (err) {
        Log.error(`MMM-Regenkarte: poll cycle failed: ${err.stack || err}`)
      }
    }

    // Instant backfill so history is populated immediately on startup, instead
    // of waiting ~2h for it to accumulate one poll cycle at a time.
    try {
      await client.backfillHistory(store, pollingIntervalMinutes, maxHistoryFrames)
      this._sendSnapshot(identifier, store)
    } catch (err) {
      Log.error(`MMM-Regenkarte: startup backfill failed: ${err.stack || err}`)
    }

    await runCycleAndNotify()

    const timer = setInterval(runCycleAndNotify, pollingIntervalMinutes * 60 * 1000)
    this.instances.set(identifier, { client, store, timer })
  },

  _sendSnapshot(identifier, store) {
    const snapshot = store.getSnapshot()
    this.sendSocketNotification('DWD_RADAR_FRAMES', {
      identifier,
      bounds: snapshot.bounds,
      history: snapshot.history.map((f) => ({ time: f.time, fileName: f.fileName })),
      forecast: snapshot.forecast.map((f) => ({ time: f.time, fileName: f.fileName }))
    })
  },

  _sendRainForecast(identifier, forecast) {
    this.sendSocketNotification('DWD_RAIN_FORECAST', { identifier, ...forecast })
  },

  /**
   * Determines the geographic point used for short-term rain prediction from the radar nowcast.
   * Priority: explicit rainForecastLocation config > first marker > first mapPosition.
   * Returns null/null when no usable location is found (disables DWD-based rain forecast).
   */
  _getRainForecastLocation(config) {
    if (config.rainForecastLocation?.lat != null && config.rainForecastLocation?.lng != null) {
      return { targetLat: config.rainForecastLocation.lat, targetLon: config.rainForecastLocation.lng }
    }
    if (config.markers?.length > 0) {
      return { targetLat: config.markers[0].lat, targetLon: config.markers[0].lng }
    }
    if (config.mapPositions?.length > 0) {
      return { targetLat: config.mapPositions[0].lat, targetLon: config.mapPositions[0].lng }
    }
    return { targetLat: null, targetLon: null }
  }
})
