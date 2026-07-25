const assert = require('node:assert/strict')
const { test, describe } = require('node:test')
const { colorFor } = require('../../backend/colorRamps')

describe('colorFor', () => {
  test('0 mm/h is fully transparent on both ramps', () => {
    for (const scheme of ['blue', 'classic', 'violet']) {
      const [, , , a] = colorFor(0, scheme)
      assert.equal(a, 0)
    }
  })

  test('color intensity/alpha increases monotonically with rainfall rate', () => {
    for (const scheme of ['blue', 'classic', 'violet']) {
      const rates = [0, 0.2, 1, 4, 10, 25, 50, 100]
      let lastAlpha = -1
      for (const rate of rates) {
        const [, , , a] = colorFor(rate, scheme)
        assert.ok(a >= lastAlpha, `alpha should not decrease as rain rate increases (scheme=${scheme}, rate=${rate})`)
        lastAlpha = a
      }
    }
  })

  test('values above the highest stop clamp to the last color', () => {
    for (const scheme of ['blue', 'classic', 'violet']) {
      const atMax = colorFor(100, scheme)
      const wayAboveMax = colorFor(500, scheme)
      assert.deepEqual(wayAboveMax, atMax)
    }
  })

  test('unknown scheme falls back to blue', () => {
    assert.deepEqual(colorFor(10, 'nonexistent'), colorFor(10, 'blue'))
  })

  test('violet ramp is magenta-hued (red channel exceeds green), unlike OSM water (green/blue dominant, no red)', () => {
    for (const rate of [0.2, 1, 4, 10, 25, 50, 100]) {
      const [vr, vg] = colorFor(rate, 'violet')
      assert.ok(vr > vg, `violet should be red-dominant over green at rate=${rate}`)
    }
  })

  test('returns RGBA components within valid byte range', () => {
    for (const scheme of ['blue', 'classic', 'violet']) {
      for (const rate of [0, 0.5, 5, 50, 200]) {
        const [r, g, b, a] = colorFor(rate, scheme)
        for (const c of [r, g, b, a]) {
          assert.ok(c >= 0 && c <= 255, `component ${c} out of range for scheme=${scheme}, rate=${rate}`)
        }
      }
    }
  })
})
