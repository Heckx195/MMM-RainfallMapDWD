const proj4 = require('proj4')

/**
 * Builds a reusable resampling plan that maps every pixel of a target
 * Plate-Carrée (lat/lon aligned) output raster to bilinear-interpolated
 * coordinates in the source polar-stereographic RADOLAN grid.
 *
 * This is expensive (one proj4 forward-projection per output pixel), but the
 * DWD RV grid definition (projection + corner coordinates + resolution) is
 * identical for every lead-time member of a given poll cycle - and in practice
 * never changes between polls either - so the plan is built once and reused
 * to resample all ~25 members of a cycle (and across cycles, since gridDef is
 * stable), turning an O(frames * pixels) cost into an effectively O(pixels) one.
 *
 * @param {{ width: number, height: number, xscale: number, yscale: number, projdef: string,
 *           ulLat: number, ulLon: number, urLat: number, urLon: number,
 *           llLat: number, llLon: number, lrLat: number, lrLon: number }} gridDef
 * @param {number} outWidth
 * @param {number} outHeight
 * @returns {{
 *   outWidth: number, outHeight: number,
 *   bounds: { south: number, west: number, north: number, east: number },
 *   row0: Int32Array, col0: Int32Array, wRow: Float32Array, wCol: Float32Array, inBounds: Uint8Array,
 *   srcWidth: number, srcHeight: number
 * }}
 */
function buildSamplingPlan(gridDef, outWidth, outHeight) {
  const { width: srcWidth, height: srcHeight, xscale, yscale, projdef, ulLat, ulLon } = gridDef
  const converter = proj4(projdef)

  // Projected bounding-box edges of the source grid (verified against real DWD
  // data: corner attributes are the outer edge of the bbox, not a pixel center).
  const [xMin, yMax] = converter.forward([ulLon, ulLat])
  const xMax = xMin + srcWidth * xscale
  const yMin = yMax - srcHeight * yscale

  // Geographic bounding box for the output raster: envelope of all four
  // projected corners. The true footprint is a slightly curved quadrilateral
  // in lat/lon space, so this rectangle is a small (sub-degree) over-approximation
  // near the edges - acceptable for a rain-map overlay.
  const lats = [gridDef.ulLat, gridDef.urLat, gridDef.llLat, gridDef.lrLat]
  const lons = [gridDef.ulLon, gridDef.urLon, gridDef.llLon, gridDef.lrLon]
  const bounds = {
    south: Math.min(...lats),
    north: Math.max(...lats),
    west: Math.min(...lons),
    east: Math.max(...lons)
  }

  const row0 = new Int32Array(outWidth * outHeight)
  const col0 = new Int32Array(outWidth * outHeight)
  const wRow = new Float32Array(outWidth * outHeight)
  const wCol = new Float32Array(outWidth * outHeight)
  const inBounds = new Uint8Array(outWidth * outHeight)

  for (let py = 0; py < outHeight; py++) {
    const lat = bounds.north - ((py + 0.5) / outHeight) * (bounds.north - bounds.south)
    for (let px = 0; px < outWidth; px++) {
      const lon = bounds.west + ((px + 0.5) / outWidth) * (bounds.east - bounds.west)
      const idx = py * outWidth + px

      const [x, y] = converter.forward([lon, lat])
      if (x < xMin || x >= xMax || y < yMin || y >= yMax) {
        inBounds[idx] = 0
        continue
      }

      // Fractional source pixel-center coordinates (pixel (0,0) center is at
      // half a cell inward from the xMin/yMax bbox edge).
      const fCol = (x - xMin) / xscale - 0.5
      const fRow = (yMax - y) / yscale - 0.5

      const c0 = Math.floor(fCol)
      const r0 = Math.floor(fRow)

      inBounds[idx] = 1
      row0[idx] = r0
      col0[idx] = c0
      wCol[idx] = fCol - c0
      wRow[idx] = fRow - r0
    }
  }

  return { outWidth, outHeight, bounds, row0, col0, wRow, wCol, inBounds, srcWidth, srcHeight }
}

/**
 * Resamples a decoded source grid (physical mm values, NaN = no data) onto the
 * output raster described by `plan`, using bilinear interpolation among the up
 * to 4 neighboring source pixels. NaN neighbors are excluded and the remaining
 * weights renormalized; if all 4 neighbors are NaN (or the pixel falls outside
 * the source grid), the output pixel is NaN (fully transparent).
 *
 * @param {ReturnType<typeof buildSamplingPlan>} plan
 * @param {Float32Array} sourceGrid
 * @returns {Float32Array} outWidth * outHeight, physical mm values, NaN = no data
 */
function applySamplingPlan(plan, sourceGrid) {
  const { outWidth, outHeight, row0, col0, wRow, wCol, inBounds, srcWidth, srcHeight } = plan
  const out = new Float32Array(outWidth * outHeight)

  const clampRow = (r) => (r < 0 ? 0 : r >= srcHeight ? srcHeight - 1 : r)
  const clampCol = (c) => (c < 0 ? 0 : c >= srcWidth ? srcWidth - 1 : c)

  for (let idx = 0; idx < out.length; idx++) {
    if (!inBounds[idx]) {
      out[idx] = NaN
      continue
    }

    const r0 = clampRow(row0[idx])
    const r1 = clampRow(row0[idx] + 1)
    const c0 = clampCol(col0[idx])
    const c1 = clampCol(col0[idx] + 1)
    const fr = wRow[idx]
    const fc = wCol[idx]

    const v00 = sourceGrid[r0 * srcWidth + c0]
    const v01 = sourceGrid[r0 * srcWidth + c1]
    const v10 = sourceGrid[r1 * srcWidth + c0]
    const v11 = sourceGrid[r1 * srcWidth + c1]

    const w00 = (1 - fr) * (1 - fc)
    const w01 = (1 - fr) * fc
    const w10 = fr * (1 - fc)
    const w11 = fr * fc

    let sum = 0
    let weight = 0
    if (!Number.isNaN(v00)) {
      sum += v00 * w00
      weight += w00
    }
    if (!Number.isNaN(v01)) {
      sum += v01 * w01
      weight += w01
    }
    if (!Number.isNaN(v10)) {
      sum += v10 * w10
      weight += w10
    }
    if (!Number.isNaN(v11)) {
      sum += v11 * w11
      weight += w11
    }

    out[idx] = weight > 0 ? sum / weight : NaN
  }

  return out
}

module.exports = { buildSamplingPlan, applySamplingPlan }
