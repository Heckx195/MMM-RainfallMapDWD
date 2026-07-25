const fs = require('fs')
const path = require('path')

/**
 * Holds the current set of radar frames (rolling history + latest forecast)
 * and the PNG cache files backing them, so that node_helper only ever needs
 * to hand a small, ready-to-send payload to the frontend.
 *
 * History frames accumulate one-by-one (oldest dropped once maxHistoryFrames
 * is exceeded); forecast frames are replaced wholesale every poll cycle,
 * since each cycle's forecast supersedes the previous one entirely.
 */
class FrameStore {
  /**
   * @param {string} cacheDir absolute path to the directory PNG files are written to
   * @param {number} maxHistoryFrames
   */
  constructor(cacheDir, maxHistoryFrames) {
    this.cacheDir = cacheDir
    this.maxHistoryFrames = maxHistoryFrames
    /** @type {{time: number, fileName: string}[]} ascending by time */
    this.history = []
    /** @type {{time: number, fileName: string}[]} ascending by time */
    this.forecast = []
    /** @type {{south: number, west: number, north: number, east: number} | null} */
    this.bounds = null

    fs.mkdirSync(cacheDir, { recursive: true })
  }

  setBounds(bounds) {
    this.bounds = bounds
  }

  setMaxHistoryFrames(maxHistoryFrames) {
    this.maxHistoryFrames = maxHistoryFrames
    this._trimHistory()
  }

  /**
   * Adds (or replaces, if the same timestamp already exists) a single
   * "current analysis" frame to the rolling history, then trims to maxHistoryFrames.
   * @param {{time: number, fileName: string}} frame
   */
  addHistoryFrame(frame) {
    const existingIndex = this.history.findIndex((f) => f.time === frame.time)
    if (existingIndex >= 0) {
      this._deleteFile(this.history[existingIndex].fileName)
      this.history[existingIndex] = frame
    } else {
      this.history.push(frame)
      this.history.sort((a, b) => a.time - b.time)
    }
    this._trimHistory()
  }

  _trimHistory() {
    while (this.history.length > this.maxHistoryFrames) {
      const removed = this.history.shift()
      this._deleteFile(removed.fileName)
    }
  }

  /**
   * Replaces the entire forecast frame list, deleting any previously cached
   * forecast PNGs that are no longer part of the new set.
   * @param {{time: number, fileName: string}[]} frames ascending by time
   */
  setForecastFrames(frames) {
    const newFileNames = new Set(frames.map((f) => f.fileName))
    for (const old of this.forecast) {
      if (!newFileNames.has(old.fileName)) {
        this._deleteFile(old.fileName)
      }
    }
    this.forecast = frames
  }

  _deleteFile(fileName) {
    try {
      fs.unlinkSync(path.join(this.cacheDir, fileName))
    } catch {
      // Already gone - fine.
    }
  }

  /**
   * @returns {{
   *   bounds: {south: number, west: number, north: number, east: number} | null,
   *   history: {time: number, fileName: string}[],
   *   forecast: {time: number, fileName: string}[]
   * }}
   */
  getSnapshot() {
    return { bounds: this.bounds, history: this.history, forecast: this.forecast }
  }
}

module.exports = { FrameStore }
