// Color ramps map a precipitation rate in mm/h to an RGBA color.
// Stops are (mmPerHour, [r,g,b,a]) pairs; colors are linearly interpolated
// between consecutive stops, clamped at the ends. alpha 0 = fully transparent.

const RAMPS = {
  blue: [
    [0, [0, 0, 0, 0]],
    [0.2, [120, 190, 240, 60]],
    [1, [70, 150, 230, 140]],
    [4, [40, 110, 220, 190]],
    [10, [30, 80, 200, 220]],
    [25, [40, 40, 180, 240]],
    [50, [90, 20, 160, 255]],
    [100, [150, 10, 120, 255]]
  ],
  classic: [
    [0, [0, 0, 0, 0]],
    [0.2, [100, 200, 100, 70]],
    [1, [60, 190, 60, 150]],
    [4, [230, 220, 60, 190]],
    [10, [230, 160, 30, 220]],
    [25, [220, 80, 20, 240]],
    [50, [200, 20, 20, 255]],
    [100, [120, 0, 60, 255]]
  ],
  // Magenta/violet hues to stay visually distinct from OpenStreetMap's light blue lakes/rivers
  violet: [
    [0, [0, 0, 0, 0]],
    [0.2, [230, 170, 240, 60]],
    [1, [200, 120, 230, 140]],
    [4, [170, 70, 210, 190]],
    [10, [140, 30, 190, 220]],
    [25, [110, 10, 160, 240]],
    [50, [80, 0, 130, 255]],
    [100, [50, 0, 90, 255]]
  ]
}

/**
 * @param {number} mmPerHour
 * @param {'blue'|'classic'|'violet'} scheme
 * @returns {[number, number, number, number]} r,g,b,a (0-255)
 */
function colorFor(mmPerHour, scheme) {
  const stops = RAMPS[scheme] || RAMPS.blue
  if (mmPerHour <= stops[0][0]) return stops[0][1]
  for (let i = 1; i < stops.length; i++) {
    const [hi, hiColor] = stops[i]
    if (mmPerHour <= hi) {
      const [lo, loColor] = stops[i - 1]
      const t = (mmPerHour - lo) / (hi - lo)
      return [
        loColor[0] + (hiColor[0] - loColor[0]) * t,
        loColor[1] + (hiColor[1] - loColor[1]) * t,
        loColor[2] + (hiColor[2] - loColor[2]) * t,
        loColor[3] + (hiColor[3] - loColor[3]) * t
      ]
    }
  }
  return stops[stops.length - 1][1]
}

module.exports = { colorFor, RAMPS }
