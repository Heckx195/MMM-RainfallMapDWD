const path = require('path')
const NodeHelper = require('node_helper')
const Log = require('logger')
const { DwdRvClient } = require('./backend/dwdRvClient')
const { FrameStore } = require('./backend/frameStore')

const MIN_POLLING_INTERVAL_MINUTES = 5

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

    const cacheDir = path.join(this.path, 'cache', identifier)
    const client = new DwdRvClient({
      cacheDir,
      outWidth: config.radarRasterWidth,
      outHeight: config.radarRasterHeight,
      colorScheme: config.radarColorScheme,
      log: Log
    })
    const store = new FrameStore(cacheDir, maxHistoryFrames)

    const runCycleAndNotify = async () => {
      try {
        await client.pollCycle(store, pollingIntervalMinutes, config.maxForecastFrames)
        this._sendSnapshot(identifier, store)
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
  }
})
