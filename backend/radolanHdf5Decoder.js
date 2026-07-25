const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

let h5wasmPromise = null
function getH5wasm() {
  if (!h5wasmPromise) {
    h5wasmPromise = import('h5wasm/node').then(async (mod) => {
      await mod.ready
      return mod
    })
  }
  return h5wasmPromise
}

/**
 * Decodes a single DWD RADOLAN RV ODIM_H5 member (one lead-time frame) into a
 * physical-value grid (mm accumulated over the 5-minute product interval).
 *
 * Verified against a real DWD file (2026-07-24): the grid is stored row-major
 * with row 0 = north (matching the UL_* corner attributes), dtype uint32,
 * physical value = raw * gain + offset, with `nodata`/`undetect` special values.
 *
 * @param {Buffer} hdf5Buffer
 * @returns {Promise<{
 *   grid: Float32Array, width: number, height: number,
 *   projdef: string, xscale: number, yscale: number,
 *   ulLat: number, ulLon: number, urLat: number, urLon: number,
 *   llLat: number, llLon: number, lrLat: number, lrLon: number
 * }>}
 */
async function decodeRadolanHdf5(hdf5Buffer) {
  const h5wasm = await getH5wasm()

  const tmpFile = path.join(os.tmpdir(), `dwd-rv-${crypto.randomUUID()}.h5`)
  fs.writeFileSync(tmpFile, hdf5Buffer)

  try {
    const f = new h5wasm.File(tmpFile, 'r')
    try {
      const where = f.get('where').attrs
      const what = f.get('/dataset1/data1/what').attrs
      const dataset = f.get('/dataset1/data1/data')

      const width = Number(where.xsize.value)
      const height = Number(where.ysize.value)
      const xscale = Number(where.xscale.value)
      const yscale = Number(where.yscale.value)
      const projdef = where.projdef.value

      const gain = Number(what.gain.value)
      const offset = Number(what.offset.value)
      const nodata = Number(what.nodata.value)
      const undetect = Number(what.undetect.value)

      const raw = dataset.value // Uint32Array, row-major, row 0 = north
      if (raw.length !== width * height) {
        throw new Error(`RADOLAN RV: unexpected data length ${raw.length}, expected ${width * height}`)
      }

      const grid = new Float32Array(raw.length)
      for (let i = 0; i < raw.length; i++) {
        const v = raw[i]
        if (v === nodata) {
          grid[i] = NaN
        } else if (v === undetect) {
          grid[i] = 0
        } else {
          grid[i] = v * gain + offset
        }
      }

      return {
        grid,
        width,
        height,
        projdef,
        xscale,
        yscale,
        ulLat: Number(where.UL_lat.value),
        ulLon: Number(where.UL_lon.value),
        urLat: Number(where.UR_lat.value),
        urLon: Number(where.UR_lon.value),
        llLat: Number(where.LL_lat.value),
        llLon: Number(where.LL_lon.value),
        lrLat: Number(where.LR_lat.value),
        lrLon: Number(where.LR_lon.value)
      }
    } finally {
      f.close()
    }
  } finally {
    fs.unlinkSync(tmpFile)
  }
}

module.exports = { decodeRadolanHdf5 }
