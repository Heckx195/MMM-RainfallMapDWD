const { PNG } = require('pngjs')
const { colorFor } = require('./colorRamps')

/**
 * Renders a resampled physical-value grid (mm accumulated over the DWD RV
 * product's 5-minute interval, NaN = no data) into a colorized, transparent-
 * where-dry PNG buffer.
 *
 * @param {Float32Array} grid mm per 5-minute interval, NaN = no data, length = width*height
 * @param {number} width
 * @param {number} height
 * @param {'blue'|'classic'|'violet'|'dwd'} colorScheme
 * @returns {Buffer} PNG file bytes
 */
function renderRadarPng(grid, width, height, colorScheme) {
  const png = new PNG({ width, height })

  for (let i = 0; i < grid.length; i++) {
    const mm5min = grid[i]
    const offset = i * 4
    if (Number.isNaN(mm5min)) {
      png.data[offset] = 0
      png.data[offset + 1] = 0
      png.data[offset + 2] = 0
      png.data[offset + 3] = 0
      continue
    }
    const mmPerHour = Math.max(0, mm5min) * 12
    const [r, g, b, a] = colorFor(mmPerHour, colorScheme)
    png.data[offset] = r
    png.data[offset + 1] = g
    png.data[offset + 2] = b
    png.data[offset + 3] = a
  }

  return PNG.sync.write(png)
}

module.exports = { renderRadarPng }
