const fs = require('fs')
const path = require('path')
const { extractTar } = require('./tarExtract')
const { decodeRadolanHdf5 } = require('./radolanHdf5Decoder')
const { buildSamplingPlan, applySamplingPlan } = require('./reprojector')
const { renderRadarPng } = require('./radarPngRenderer')

const BASE_URL = 'https://opendata.dwd.de/weather/radar/composite/rv'
const FORECAST_HORIZON_MINUTES = 120

function pad(n, len = 2) {
  return String(n).padStart(len, '0')
}

function tsString(date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}_${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`
}

function parseTsString(ts) {
  const y = Number(ts.slice(0, 4))
  const mo = Number(ts.slice(4, 6)) - 1
  const d = Number(ts.slice(6, 8))
  const h = Number(ts.slice(9, 11))
  const mi = Number(ts.slice(11, 13))
  return new Date(Date.UTC(y, mo, d, h, mi))
}

function memberName(ts, leadMinutes) {
  return `composite_rv_${ts}_${pad(leadMinutes, 3)}-hd5`
}

function tarUrl(ts) {
  return `${BASE_URL}/composite_rv_${ts}.tar`
}

/**
 * Orchestrates downloading, decoding, reprojecting and rendering DWD RADOLAN
 * RV radar data into cached PNG frames tracked by a FrameStore.
 */
class DwdRvClient {
  /**
   * @param {{ cacheDir: string, outWidth: number, outHeight: number, colorScheme: 'blue'|'classic'|'violet', log?: typeof console }} options
   */
  constructor({ cacheDir, outWidth, outHeight, colorScheme, log = console }) {
    this.cacheDir = cacheDir
    this.outWidth = outWidth
    this.outHeight = outHeight
    this.colorScheme = colorScheme
    this.log = log
    /** @type {{ plan: ReturnType<typeof buildSamplingPlan>, gridKey: string } | null} */
    this._planCache = null
  }

  _getOrBuildPlan(gridDef) {
    const gridKey = JSON.stringify({
      w: gridDef.width,
      h: gridDef.height,
      ul: [gridDef.ulLat, gridDef.ulLon],
      scale: [gridDef.xscale, gridDef.yscale],
      proj: gridDef.projdef
    })
    if (!this._planCache || this._planCache.gridKey !== gridKey) {
      this._planCache = { plan: buildSamplingPlan(gridDef, this.outWidth, this.outHeight), gridKey }
    }
    return this._planCache.plan
  }

  async _downloadTar(ts) {
    const url = tarUrl(ts)
    const response = await fetch(url)
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`DWD RV download failed for ${ts}: HTTP ${response.status} ${response.statusText}`)
    }
    return Buffer.from(await response.arrayBuffer())
  }

  /**
   * @returns {Promise<string[]>} sorted (ascending) timestamp strings 'YYYYMMDD_HHMM' currently retained by DWD
   */
  async listAvailableTimestamps() {
    const response = await fetch(`${BASE_URL}/`)
    if (!response.ok) {
      throw new Error(`Failed to list DWD RV directory: HTTP ${response.status} ${response.statusText}`)
    }
    const html = await response.text()
    const matches = new Set()
    for (const m of html.matchAll(/composite_rv_(\d{8}_\d{4})\.tar/g)) {
      matches.add(m[1])
    }
    return [...matches].sort()
  }

  /**
   * Decodes+reprojects+renders a single member from an already-extracted tar entry map.
   * @param {Map<string, Buffer>} entries
   * @param {string} ts
   * @param {number} leadMinutes
   * @returns {Promise<{ time: number, fileName: string } | null>} null if the member is missing from the archive
   */
  async _renderMember(entries, ts, leadMinutes) {
    const buf = entries.get(memberName(ts, leadMinutes))
    if (!buf) return null

    const decoded = await decodeRadolanHdf5(buf)
    const plan = this._getOrBuildPlan(decoded)
    const resampled = applySamplingPlan(plan, decoded.grid)
    const png = renderRadarPng(resampled, this.outWidth, this.outHeight, this.colorScheme)

    const fileName = `${ts}_${pad(leadMinutes, 3)}.png`
    fs.writeFileSync(path.join(this.cacheDir, fileName), png)

    const slotDate = parseTsString(ts)
    const time = Math.floor(slotDate.getTime() / 1000) + leadMinutes * 60
    return { time, fileName, bounds: plan.bounds }
  }

  /**
   * Runs one regular poll cycle: fetches the latest available slot (stepping
   * backward a few intervals if the newest one isn't published yet), renders
   * its "now" frame into history and the requested forecast leads, and updates the store.
   * @param {import('./frameStore').FrameStore} frameStore
   * @param {number} pollingIntervalMinutes
   * @param {number} maxForecastFrames -1 = all available (up to the 120min horizon), 0 = none, N = N leads
   */
  async pollCycle(frameStore, pollingIntervalMinutes, maxForecastFrames = -1) {
    const now = new Date()
    const totalMinutes = now.getUTCHours() * 60 + now.getUTCMinutes()
    const slotMinutes = Math.floor(totalMinutes / pollingIntervalMinutes) * pollingIntervalMinutes
    let slotDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, slotMinutes))

    const maxBackSteps = 3
    let tarBuffer = null
    let ts = ''
    for (let step = 0; step <= maxBackSteps; step++) {
      ts = tsString(slotDate)
      try {
        tarBuffer = await this._downloadTar(ts)
      } catch (err) {
        this.log.error(`MMM-Regenkarte: error downloading DWD RV tar for ${ts}:`, err)
        tarBuffer = null
      }
      if (tarBuffer) break
      slotDate = new Date(slotDate.getTime() - pollingIntervalMinutes * 60 * 1000)
    }

    if (!tarBuffer) {
      this.log.warn('MMM-Regenkarte: no DWD RV data available after retries, keeping previous frames.')
      return
    }

    const maxLead =
      maxForecastFrames < 0
        ? FORECAST_HORIZON_MINUTES
        : Math.min(FORECAST_HORIZON_MINUTES, maxForecastFrames * pollingIntervalMinutes)
    const leads = [0]
    for (let l = pollingIntervalMinutes; l <= maxLead; l += pollingIntervalMinutes) {
      leads.push(l)
    }
    const wantedNames = new Set(leads.map((l) => memberName(ts, l)))
    const entries = await extractTar(tarBuffer, (name) => wantedNames.has(name))

    const nowFrame = await this._renderMember(entries, ts, 0)
    if (nowFrame) {
      frameStore.setBounds(nowFrame.bounds)
      frameStore.addHistoryFrame({ time: nowFrame.time, fileName: nowFrame.fileName })
    }

    const forecastFrames = []
    for (const lead of leads) {
      if (lead === 0) continue
      const frame = await this._renderMember(entries, ts, lead)
      if (frame) forecastFrames.push({ time: frame.time, fileName: frame.fileName })
    }
    frameStore.setForecastFrames(forecastFrames)

    this.log.log(
      `MMM-RainfallMapDWD: processed DWD RV cycle ${ts} (1 history + ${forecastFrames.length} forecast frames).`
    )
  }

  /**
   * One-time startup backfill: pulls the last `maxHistoryFrames` aligned
   * "now" snapshots directly from DWD's ~48h rolling archive, so the module
   * shows a full history immediately instead of building it up over 2 hours.
   * @param {import('./frameStore').FrameStore} frameStore
   * @param {number} pollingIntervalMinutes
   * @param {number} maxHistoryFrames
   */
  async backfillHistory(frameStore, pollingIntervalMinutes, maxHistoryFrames) {
    if (maxHistoryFrames <= 0) return

    let available
    try {
      available = await this.listAvailableTimestamps()
    } catch (err) {
      this.log.error('MMM-RainfallMapDWD: failed to list DWD RV directory for backfill:', err)
      return
    }

    const aligned = available.filter((ts) => {
      const d = parseTsString(ts)
      return (d.getUTCHours() * 60 + d.getUTCMinutes()) % pollingIntervalMinutes === 0
    })

    // Take the most recent `maxHistoryFrames` aligned timestamps, excluding the
    // very latest one (the upcoming regular pollCycle() will fetch that).
    const candidates = aligned.slice(0, -1).slice(-maxHistoryFrames)

    for (const ts of candidates) {
      let tarBuffer
      try {
        tarBuffer = await this._downloadTar(ts)
      } catch (err) {
        this.log.warn(`MMM-RainfallMapDWD: backfill download failed for ${ts}, skipping:`, err.message)
        continue
      }
      if (!tarBuffer) continue

      try {
        const wantedName = memberName(ts, 0)
        const entries = await extractTar(tarBuffer, (name) => name === wantedName)
        const frame = await this._renderMember(entries, ts, 0)
        if (frame) {
          frameStore.setBounds(frame.bounds)
          frameStore.addHistoryFrame({ time: frame.time, fileName: frame.fileName })
        }
      } catch (err) {
        this.log.warn(`MMM-RainfallMapDWD: backfill decode/render failed for ${ts}, skipping:`, err.message)
      }
    }

    this.log.log(`MMM-RainfallMapDWD: backfilled ${frameStore.history.length} history frame(s) on startup.`)
  }
}

module.exports = { DwdRvClient, tsString, parseTsString, memberName }
