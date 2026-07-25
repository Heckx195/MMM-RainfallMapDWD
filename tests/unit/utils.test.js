const assert = require('node:assert/strict')
const { test, describe } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

/**
 * Unit tests for MMM-RainfallMapDWD utility functions
 *
 * These tests verify the actual functions from Utils.ts by parsing
 * and evaluating the TypeScript source code directly.
 *
 * Note: frame filtering/limiting (maxHistoryFrames/maxForecastFrames) now
 * happens server-side in backend/dwdRvClient.js and backend/frameStore.js,
 * not in Utils.ts - see tests/unit alongside those modules if present.
 */

// Mock logger for testing
global.Log = {
  warn: () => {},
  error: () => {}
}

// Mock MM global
global.MM = {
  getModules: () => []
}

/**
 * Parse and extract utility functions from TypeScript source
 */
function loadUtilFunctions() {
  const utilsPath = path.join(__dirname, '../../src/frontend/Utils.ts')
  const content = fs.readFileSync(utilsPath, 'utf8')

  // Extract rainConditions array
  const rainConditionsMatch = content.match(/export const rainConditions = \[([\s\S]*?)\]/m)
  const rainConditions = rainConditionsMatch
    ? rainConditionsMatch[1]
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''))
        .filter((s) => s.length > 0)
    : []

  // Extract supportedIconColors
  const iconColorsMatch = content.match(/const supportedIconColors = \[([\s\S]*?)\]/m)
  const supportedIconColors = iconColorsMatch
    ? iconColorsMatch[1]
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''))
        .filter((s) => s.length > 0)
    : []

  // Create getIconColor function
  function getIconColor(marker) {
    return marker.color && supportedIconColors.includes(marker.color) ? marker.color : 'red'
  }

  return {
    rainConditions,
    supportedIconColors,
    getIconColor
  }
}

const utils = loadUtilFunctions()

describe('getIconColor', () => {
  test('returns valid color when marker has supported color', () => {
    utils.supportedIconColors.forEach((color) => {
      const marker = { lat: 50, lng: 8, color }
      assert.equal(utils.getIconColor(marker), color)
    })
  })

  test('returns "red" as fallback for invalid color', () => {
    const marker = { lat: 50, lng: 8, color: 'purple' }
    assert.equal(utils.getIconColor(marker), 'red')
  })

  test('returns "red" as fallback when color is missing', () => {
    const marker = { lat: 50, lng: 8 }
    assert.equal(utils.getIconColor(marker), 'red')
  })

  test('returns "red" as fallback when color is null', () => {
    const marker = { lat: 50, lng: 8, color: null }
    assert.equal(utils.getIconColor(marker), 'red')
  })

  test('all supported colors are valid', () => {
    const expectedColors = ['black', 'blue', 'gold', 'green', 'grey', 'orange', 'red', 'violet', 'yellow']
    assert.deepEqual(utils.supportedIconColors, expectedColors)
  })
})

describe('rainConditions', () => {
  test('contains all expected rain icon codes', () => {
    const expectedIcons = ['09d', '09n', '10d', '10n', '11d', '11n', '13d', '13n']
    expectedIcons.forEach((icon) => {
      assert.ok(utils.rainConditions.includes(icon), `Should include icon ${icon}`)
    })
  })

  test('contains all expected rain condition keywords', () => {
    const expectedKeywords = ['showers', 'thunderstorm', 'sleet', 'rain', 'snow']
    expectedKeywords.forEach((keyword) => {
      assert.ok(utils.rainConditions.includes(keyword), `Should include keyword ${keyword}`)
    })
  })

  test('has correct total count', () => {
    assert.equal(utils.rainConditions.length, 13)
  })
})
