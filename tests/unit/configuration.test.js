const assert = require('node:assert/strict')
const { test, describe } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

/**
 * Unit tests for MMM-RainfallMapDWD configuration defaults and validation
 *
 * Tests verify the default configuration values match expectations for the
 * DWD RADOLAN RV based radar pipeline (node_helper polls DWD directly, so
 * there is no RainViewer-style client-side rate limiting to guard against
 * anymore - the polling cadence is governed by pollingIntervalMinutes).
 *
 * Note: We parse the TypeScript source directly to avoid loading
 * the compiled module which includes the entire Leaflet library.
 */

/**
 * Extract defaults from TypeScript source file
 */
function extractDefaults() {
  const tsPath = path.join(__dirname, '../../src/frontend/Frontend.ts')
  const content = fs.readFileSync(tsPath, 'utf8')

  const defaults = {}

  // Parse individual values directly from the source file
  const patterns = [
    { key: 'animationSpeedMs', regex: /animationSpeedMs:\s*(\d+)/ },
    { key: 'defaultZoomLevel', regex: /defaultZoomLevel:\s*(\d+)/ },
    { key: 'maxHistoryFrames', regex: /maxHistoryFrames:\s*(-?\d+)/ },
    { key: 'maxForecastFrames', regex: /maxForecastFrames:\s*(-?\d+)/ },
    { key: 'pollingIntervalMinutes', regex: /pollingIntervalMinutes:\s*(\d+)/ },
    { key: 'radarRasterWidth', regex: /radarRasterWidth:\s*(\d+)/ },
    { key: 'radarRasterHeight', regex: /radarRasterHeight:\s*(\d+)/ }
  ]

  for (const { key, regex } of patterns) {
    const match = content.match(regex)
    if (match) {
      defaults[key] = parseInt(match[1], 10)
    }
  }

  const colorSchemeMatch = content.match(/radarColorScheme:\s*'(\w+)'/)
  defaults.radarColorScheme = colorSchemeMatch ? colorSchemeMatch[1] : null

  return defaults
}

const defaults = extractDefaults()

describe('MMM-RainfallMapDWD Configuration', () => {
  describe('Default Values', () => {
    test('defaults were extracted from source', () => {
      assert.ok(defaults, 'Defaults should be extracted')
      assert.ok(Object.keys(defaults).length > 0, 'Defaults should have values')
    })

    test('animationSpeedMs is set to 800', () => {
      assert.equal(defaults.animationSpeedMs, 800)
    })

    test('defaultZoomLevel is set to 6', () => {
      assert.equal(defaults.defaultZoomLevel, 6)
    })

    test('maxHistoryFrames is set to 6', () => {
      assert.equal(defaults.maxHistoryFrames, 6)
    })

    test('maxForecastFrames defaults to -1 (all available, up to the 2h DWD RV horizon)', () => {
      assert.equal(defaults.maxForecastFrames, -1)
    })

    test('pollingIntervalMinutes defaults to 5 (DWD RV native product interval)', () => {
      assert.equal(defaults.pollingIntervalMinutes, 5)
    })

    test('radarRasterWidth/Height are set to a sensible default (DE1200 aspect ratio)', () => {
      assert.equal(defaults.radarRasterWidth, 800)
      assert.equal(defaults.radarRasterHeight, 873)
    })

    test('radarColorScheme defaults to "blue"', () => {
      assert.equal(defaults.radarColorScheme, 'blue')
    })
  })

  describe('DWD polling configuration sanity', () => {
    test('pollingIntervalMinutes is a positive multiple of 5 (DWD only publishes every 5 minutes)', () => {
      assert.ok(defaults.pollingIntervalMinutes > 0, 'pollingIntervalMinutes must be positive')
      assert.equal(
        defaults.pollingIntervalMinutes % 5,
        0,
        'pollingIntervalMinutes must be a multiple of 5 to align with DWD RV file timestamps'
      )
    })

    test('animationSpeedMs is at least 500ms (keeps the animation legible)', () => {
      assert.ok(defaults.animationSpeedMs >= 500)
    })

    test('radarRasterWidth/Height are positive', () => {
      assert.ok(defaults.radarRasterWidth > 0)
      assert.ok(defaults.radarRasterHeight > 0)
    })
  })
})
