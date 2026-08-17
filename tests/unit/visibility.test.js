const assert = require('node:assert/strict')
const { test, describe } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

/**
 * Unit tests for MMM-RainfallMapDWD visibility logic (displayHoursBeforeRain feature)
 *
 * These tests verify that the module correctly shows/hides itself based on rain predictions
 * and that it properly tracks its visibility state independently of external module managers
 * like MMM-Carousel.
 */

// Mock dependencies
global.Log = {
  log: () => {},
  warn: () => {},
  error: () => {}
}

global.MM = {
  getModules: () => []
}

/**
 * Extract rainConditions from TypeScript source
 */
function getRainConditions() {
  const utilsPath = path.join(__dirname, '../../src/frontend/Utils.ts')
  const content = fs.readFileSync(utilsPath, 'utf8')
  const match = content.match(/export const rainConditions = \[([\s\S]*?)\]/m)
  return match
    ? match[1]
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''))
        .filter((s) => s.length > 0)
    : []
}

const rainConditions = getRainConditions()

/**
 * Create a mock module instance with tracking
 */
function createMockModule(config = {}) {
  const defaultConfig = {
    displayHoursBeforeRain: -1,
    substitudeModules: []
  }

  const calls = {
    show: [],
    hide: [],
    play: []
  }

  const module = {
    config: { ...defaultConfig, ...config },
    identifier: 'test-module',
    runtimeData: {
      isHiddenDueToNoRain: false,
      animationTimer: null,
      dwdRainMinutes: undefined,
      hourlyRainHours: undefined,
      hourlyWarningShown: false
    },
    show(duration, callback, options) {
      calls.show.push({ duration, callback, options })
    },
    hide(duration, callback, options) {
      calls.hide.push({ duration, callback, options })
    },
    play() {
      calls.play.push({})
      this.runtimeData.animationTimer = setTimeout(() => {}, 1000)
    },
    _calls: calls
  }

  return module
}

/**
 * Simplified version of handleCurrentWeatherCondition from Frontend.ts
 */
function handleCurrentWeatherCondition(module, currentCondition) {
  const hasRain = currentCondition && rainConditions.some((condition) => currentCondition.includes(condition))

  if (hasRain) {
    // Rain detected - show module if it was hidden due to no rain
    if (module.runtimeData.isHiddenDueToNoRain) {
      module.runtimeData.isHiddenDueToNoRain = false
      module.show(300, undefined, { lockString: module.identifier })
      // Restart animation if not running
      if (!module.runtimeData.animationTimer) {
        module.play()
      }
    }
  } else {
    // No rain - hide module if currently shown
    if (!module.runtimeData.isHiddenDueToNoRain) {
      module.runtimeData.isHiddenDueToNoRain = true
      module.hide(300, undefined, { lockString: module.identifier })
      // Stop animation to save resources
      if (module.runtimeData.animationTimer) {
        clearTimeout(module.runtimeData.animationTimer)
        module.runtimeData.animationTimer = null
      }
    }
  }
}

/**
 * Simplified version of _evaluateVisibility from Frontend.ts.
 * DWD is authoritative for 0–120 min; hourly only consulted for the >2h tail
 * when threshold > 2. Missing hourly data defaults to showing the map with a warning.
 */
function evaluateVisibility(module) {
  const threshold = module.config.displayHoursBeforeRain
  const { dwdRainMinutes, hourlyRainHours } = module.runtimeData
  const dwdWindowMin = Math.min(threshold * 60, 120)

  if (dwdRainMinutes !== undefined && dwdRainMinutes !== null && dwdRainMinutes <= dwdWindowMin) {
    handleCurrentWeatherCondition(module, 'rain')
    return
  }

  if (threshold > 2) {
    if (hourlyRainHours === undefined) {
      if (!module.runtimeData.hourlyWarningShown) {
        module.runtimeData.hourlyWarningShown = true
        global.Log.warn(
          `MMM-RainfallMapDWD: displayHoursBeforeRain is set to ${threshold}h which exceeds the 2h DWD nowcast window, ` +
            `but no hourly weather module data has been received (WEATHER_UPDATED). ` +
            `The map will remain visible by default. ` +
            `Add the MagicMirror default weather module in hourly mode to enable forecasts beyond 2h.`
        )
      }
      handleCurrentWeatherCondition(module, 'rain')
      return
    }
    if (hourlyRainHours > 2 && hourlyRainHours < threshold) {
      handleCurrentWeatherCondition(module, 'rain')
      return
    }
  }

  handleCurrentWeatherCondition(module, '')
}

/**
 * Simplified version of handleDwdRainForecast from Frontend.ts
 */
function handleDwdRainForecast(module, forecast) {
  if (module.config.displayHoursBeforeRain < 0) return
  if (forecast.locationOutsideCoverage) return
  module.runtimeData.dwdRainMinutes = forecast.minutesUntilRain
  evaluateVisibility(module)
}

/**
 * Simplified version of handleWeatherUpdate from Frontend.ts.
 * Only considers hourly entries beyond the 120-min DWD nowcast window.
 */
function handleWeatherUpdate(module, update) {
  const hourlyData = update.hourlyArray
  if (!hourlyData) return

  const minLookAheadMs = 120 * 60 * 1000
  let closestRainMs = Infinity
  const now = Date.now()

  for (const entry of hourlyData) {
    if (rainConditions.some((condition) => entry.weatherType.includes(condition))) {
      const timeToRain = entry.date - now
      if (timeToRain >= minLookAheadMs && timeToRain < closestRainMs) {
        closestRainMs = timeToRain
      }
    }
  }

  module.runtimeData.hourlyRainHours = closestRainMs / 1000 / 60 / 60
  evaluateVisibility(module)
}

describe('handleCurrentWeatherCondition', () => {
  test('hides module even when displayHoursBeforeRain = -1 (if handler is called)', () => {
    const module = createMockModule({ displayHoursBeforeRain: -1 })

    // Note: When displayHoursBeforeRain = -1, notificationReceived() won't call this handler.
    // But if it's called directly, the logic still works correctly.
    handleCurrentWeatherCondition(module, '')

    assert.equal(module._calls.hide.length, 1, 'handler works regardless of config')
    assert.equal(module.runtimeData.isHiddenDueToNoRain, true)
  })

  test('hides module on first weather update without rain', () => {
    const module = createMockModule({ displayHoursBeforeRain: 0 })

    handleCurrentWeatherCondition(module, '')

    assert.equal(module._calls.hide.length, 1, 'should hide module')
    assert.equal(module.runtimeData.isHiddenDueToNoRain, true, 'should set hidden flag')
    assert.deepStrictEqual(
      module._calls.hide[0].options,
      { lockString: 'test-module' },
      'should use correct lockString'
    )
  })

  test('shows module when rain is detected', () => {
    const module = createMockModule({ displayHoursBeforeRain: 0 })
    module.runtimeData.isHiddenDueToNoRain = true

    handleCurrentWeatherCondition(module, 'rain')

    assert.equal(module._calls.show.length, 1, 'should show module')
    assert.equal(module.runtimeData.isHiddenDueToNoRain, false, 'should clear hidden flag')
    assert.equal(module._calls.play.length, 1, 'should start animation')
  })

  test('does not show module again if already visible (rain → rain)', () => {
    const module = createMockModule({ displayHoursBeforeRain: 0 })
    module.runtimeData.isHiddenDueToNoRain = false

    handleCurrentWeatherCondition(module, 'rain')

    assert.equal(module._calls.show.length, 0, 'should not show module again')
    assert.equal(module.runtimeData.isHiddenDueToNoRain, false)
  })

  test('does not hide module again if already hidden (no rain → no rain)', () => {
    const module = createMockModule({ displayHoursBeforeRain: 0 })
    module.runtimeData.isHiddenDueToNoRain = true

    handleCurrentWeatherCondition(module, '')

    assert.equal(module._calls.hide.length, 0, 'should not hide module again')
    assert.equal(module.runtimeData.isHiddenDueToNoRain, true)
  })

  test('recognizes all rain condition codes', () => {
    const module = createMockModule({ displayHoursBeforeRain: 0 })

    rainConditions.forEach((condition) => {
      module.runtimeData.isHiddenDueToNoRain = true
      module._calls.show = []

      handleCurrentWeatherCondition(module, condition)

      assert.equal(module._calls.show.length, 1, `should recognize "${condition}" as rain and show module`)
      assert.equal(module.runtimeData.isHiddenDueToNoRain, false)
    })
  })

  test('restarts animation only if not already running', () => {
    const module = createMockModule({ displayHoursBeforeRain: 0 })
    module.runtimeData.isHiddenDueToNoRain = true

    // First call - animation not running
    handleCurrentWeatherCondition(module, 'rain')
    assert.equal(module._calls.play.length, 1, 'should start animation')

    // Simulate animation now running
    module.runtimeData.animationTimer = setTimeout(() => {}, 1000)
    module.runtimeData.isHiddenDueToNoRain = true
    module._calls.play = []

    // Second call - animation already running
    handleCurrentWeatherCondition(module, 'rain')
    assert.equal(module._calls.play.length, 0, 'should not restart animation')
  })

  test('stops animation when hiding module', () => {
    const module = createMockModule({ displayHoursBeforeRain: 0 })
    module.runtimeData.animationTimer = setTimeout(() => {}, 1000)

    handleCurrentWeatherCondition(module, '')

    assert.equal(module.runtimeData.animationTimer, null, 'should clear animation timer')
  })
})

describe('handleWeatherUpdate', () => {
  test('hides module when rain is beyond configured threshold', () => {
    const module = createMockModule({ displayHoursBeforeRain: 4 })
    const now = Date.now()

    const update = {
      hourlyArray: [
        { date: now + 1000 * 60 * 60 * 5, weatherType: 'rain' } // 5h - beyond 4h threshold
      ]
    }

    handleWeatherUpdate(module, update)

    assert.equal(module.runtimeData.isHiddenDueToNoRain, true, 'should hide when rain is > 4h away')
    assert.equal(module._calls.hide.length, 1)
  })

  test('shows module when rain is within the >2h hourly window', () => {
    const module = createMockModule({ displayHoursBeforeRain: 4 })
    module.runtimeData.isHiddenDueToNoRain = true
    const now = Date.now()

    const update = {
      hourlyArray: [
        { date: now + 1000 * 60 * 60 * 3, weatherType: 'rain' } // 3h - between 2h DWD limit and 4h threshold
      ]
    }

    handleWeatherUpdate(module, update)

    assert.equal(module.runtimeData.isHiddenDueToNoRain, false, 'should show when 2h < rain < 4h')
    assert.equal(module._calls.show.length, 1)
  })

  test('skips entries within the 120-min DWD nowcast window', () => {
    const module = createMockModule({ displayHoursBeforeRain: 4 })
    const now = Date.now()

    const update = {
      hourlyArray: [
        { date: now + 1000 * 60 * 90, weatherType: 'rain' } // 90 min - inside DWD 120-min window
      ]
    }

    handleWeatherUpdate(module, update)

    // Entry skipped; no rain beyond 120 min → hides
    assert.equal(module.runtimeData.isHiddenDueToNoRain, true, 'should ignore entries within 120-min DWD window')
    assert.equal(module._calls.hide.length, 1)
  })

  test('finds closest rain event beyond the DWD 120-min window', () => {
    const module = createMockModule({ displayHoursBeforeRain: 4 })
    module.runtimeData.isHiddenDueToNoRain = true
    const now = Date.now()

    const update = {
      hourlyArray: [
        { date: now + 1000 * 60 * 90, weatherType: 'rain' }, // 90 min — skipped (inside DWD window)
        { date: now + 1000 * 60 * 60 * 5, weatherType: 'rain' }, // 5h — beyond threshold
        { date: now + 1000 * 60 * 60 * 3, weatherType: 'rain' }, // 3h — closest valid, within threshold
        { date: now + 1000 * 60 * 60 * 8, weatherType: 'thunderstorm' }
      ]
    }

    handleWeatherUpdate(module, update)

    assert.equal(module.runtimeData.isHiddenDueToNoRain, false, 'should use closest rain entry beyond 120 min')
    assert.equal(module._calls.show.length, 1)
  })

  test('hides module when no rain predicted', () => {
    const module = createMockModule({ displayHoursBeforeRain: 4 })
    const now = Date.now()

    const update = {
      hourlyArray: [
        { date: now + 1000 * 60 * 60 * 3, weatherType: 'clear' },
        { date: now + 1000 * 60 * 60 * 5, weatherType: 'cloudy' }
      ]
    }

    handleWeatherUpdate(module, update)

    assert.equal(module.runtimeData.isHiddenDueToNoRain, true, 'should hide when no rain predicted')
    assert.equal(module._calls.hide.length, 1)
  })

  test('handles empty hourly array', () => {
    const module = createMockModule({ displayHoursBeforeRain: 4 })

    const update = {
      hourlyArray: []
    }

    handleWeatherUpdate(module, update)

    assert.equal(module.runtimeData.isHiddenDueToNoRain, true, 'should hide when no data available')
    assert.equal(module._calls.hide.length, 1)
  })
})

describe('DWD nowcast rain forecast', () => {
  test('ignored when displayHoursBeforeRain is -1', () => {
    const module = createMockModule({ displayHoursBeforeRain: -1 })

    handleDwdRainForecast(module, { minutesUntilRain: 0, locationOutsideCoverage: false })

    assert.equal(module.runtimeData.dwdRainMinutes, undefined, 'should not update when -1')
    assert.equal(module._calls.hide.length, 0, 'should not evaluate visibility')
    assert.equal(module._calls.show.length, 0)
  })

  test('ignored when location is outside DWD coverage', () => {
    const module = createMockModule({ displayHoursBeforeRain: 1 })
    module.runtimeData.isHiddenDueToNoRain = false

    handleDwdRainForecast(module, { minutesUntilRain: 0, locationOutsideCoverage: true })

    assert.equal(module.runtimeData.dwdRainMinutes, undefined, 'should not update when outside coverage')
    assert.equal(module._calls.hide.length, 0, 'should not evaluate visibility')
  })

  test('shows map when DWD reports rain right now (minutesUntilRain = 0)', () => {
    const module = createMockModule({ displayHoursBeforeRain: 1 })
    module.runtimeData.isHiddenDueToNoRain = true

    handleDwdRainForecast(module, { minutesUntilRain: 0, locationOutsideCoverage: false })

    assert.equal(module.runtimeData.dwdRainMinutes, 0)
    assert.equal(module.runtimeData.isHiddenDueToNoRain, false, 'should show map')
    assert.equal(module._calls.show.length, 1)
  })

  test('shows map when DWD rain is within the configured threshold', () => {
    const module = createMockModule({ displayHoursBeforeRain: 1 }) // threshold = 60 min
    module.runtimeData.isHiddenDueToNoRain = true

    handleDwdRainForecast(module, { minutesUntilRain: 45, locationOutsideCoverage: false })

    assert.equal(module.runtimeData.isHiddenDueToNoRain, false, 'rain in 45 min is within 60 min threshold')
    assert.equal(module._calls.show.length, 1)
  })

  test('hides map when DWD rain is beyond the configured threshold', () => {
    const module = createMockModule({ displayHoursBeforeRain: 1 }) // threshold = 60 min

    handleDwdRainForecast(module, { minutesUntilRain: 90, locationOutsideCoverage: false })

    assert.equal(module.runtimeData.isHiddenDueToNoRain, true, 'rain in 90 min exceeds 60 min threshold')
    assert.equal(module._calls.hide.length, 1)
  })

  test('hides map when DWD reports no rain within 120 min and threshold <= 2', () => {
    const module = createMockModule({ displayHoursBeforeRain: 2 })

    handleDwdRainForecast(module, { minutesUntilRain: null, locationOutsideCoverage: false })

    // null = no rain in 120 min; threshold=2 → DWD-only, no hourly check → hide
    assert.equal(module.runtimeData.isHiddenDueToNoRain, true, 'should hide when DWD says no rain and threshold <= 2')
    assert.equal(module._calls.hide.length, 1)
  })

  test('DWD window is capped at 120 min even when threshold > 2h', () => {
    const module = createMockModule({ displayHoursBeforeRain: 4 }) // threshold = 240 min
    module.runtimeData.isHiddenDueToNoRain = true

    handleDwdRainForecast(module, { minutesUntilRain: 90, locationOutsideCoverage: false })

    // dwdWindowMin = min(240, 120) = 120; 90 <= 120 → show via DWD
    assert.equal(module.runtimeData.isHiddenDueToNoRain, false, 'DWD rain in 90 min should trigger show')
    assert.equal(module._calls.show.length, 1)
  })
})

describe('_evaluateVisibility combined logic', () => {
  test('threshold > 2: shows map with warning when no DWD and no hourly data', () => {
    const warnCalls = []
    const originalWarn = global.Log.warn
    global.Log.warn = (msg) => warnCalls.push(msg)

    const module = createMockModule({ displayHoursBeforeRain: 4 })
    module.runtimeData.isHiddenDueToNoRain = true
    // dwdRainMinutes = undefined, hourlyRainHours = undefined (no data yet)

    evaluateVisibility(module)

    global.Log.warn = originalWarn

    assert.equal(module.runtimeData.isHiddenDueToNoRain, false, 'should show map as safe default')
    assert.equal(module._calls.show.length, 1)
    assert.equal(warnCalls.length, 1, 'should log a warning')
    assert.ok(warnCalls[0].includes('WEATHER_UPDATED'), 'warning should mention WEATHER_UPDATED')
  })

  test('threshold > 2: warning is logged only once across repeated evaluations', () => {
    const warnCalls = []
    const originalWarn = global.Log.warn
    global.Log.warn = (msg) => warnCalls.push(msg)

    const module = createMockModule({ displayHoursBeforeRain: 4 })
    module.runtimeData.isHiddenDueToNoRain = true

    evaluateVisibility(module)
    evaluateVisibility(module)
    evaluateVisibility(module)

    global.Log.warn = originalWarn

    assert.equal(warnCalls.length, 1, 'warning should be logged only once')
    assert.equal(module.runtimeData.hourlyWarningShown, true)
  })

  test('threshold > 2: DWD rain in hand takes priority; no warning logged', () => {
    const warnCalls = []
    const originalWarn = global.Log.warn
    global.Log.warn = (msg) => warnCalls.push(msg)

    const module = createMockModule({ displayHoursBeforeRain: 4 })
    module.runtimeData.dwdRainMinutes = 30 // DWD rain in 30 min
    module.runtimeData.isHiddenDueToNoRain = true
    // hourlyRainHours still undefined

    evaluateVisibility(module)

    global.Log.warn = originalWarn

    assert.equal(module.runtimeData.isHiddenDueToNoRain, false, 'DWD should trigger show')
    assert.equal(warnCalls.length, 0, 'DWD handled it — no warning about missing hourly')
  })

  test('threshold > 2: warns and shows when DWD says no rain but hourly data missing', () => {
    const warnCalls = []
    const originalWarn = global.Log.warn
    global.Log.warn = (msg) => warnCalls.push(msg)

    const module = createMockModule({ displayHoursBeforeRain: 4 })
    module.runtimeData.dwdRainMinutes = null // DWD: no rain in 120 min
    module.runtimeData.isHiddenDueToNoRain = true
    // hourlyRainHours still undefined

    evaluateVisibility(module)

    global.Log.warn = originalWarn

    assert.equal(module.runtimeData.isHiddenDueToNoRain, false, 'should show as safe default')
    assert.equal(warnCalls.length, 1, 'should warn about missing hourly data')
  })

  test('threshold > 2: hourly covers the >2h tail when DWD shows no rain', () => {
    const module = createMockModule({ displayHoursBeforeRain: 4 })
    module.runtimeData.dwdRainMinutes = null // no rain in 120 min
    module.runtimeData.hourlyRainHours = 3 // hourly: rain in 3h (>2h, <4h)
    module.runtimeData.isHiddenDueToNoRain = true

    evaluateVisibility(module)

    assert.equal(module.runtimeData.isHiddenDueToNoRain, false, 'hourly rain in >2h tail should show map')
    assert.equal(module._calls.show.length, 1)
  })

  test('threshold > 2: hides when DWD no-rain and hourly rain is beyond threshold', () => {
    const module = createMockModule({ displayHoursBeforeRain: 4 })
    module.runtimeData.dwdRainMinutes = null
    module.runtimeData.hourlyRainHours = 5 // rain in 5h — beyond 4h threshold

    evaluateVisibility(module)

    assert.equal(module.runtimeData.isHiddenDueToNoRain, true, 'should hide when rain beyond threshold')
    assert.equal(module._calls.hide.length, 1)
  })

  test('threshold <= 2: ignores hourly data entirely, hides when DWD shows no rain', () => {
    const module = createMockModule({ displayHoursBeforeRain: 2 })
    module.runtimeData.dwdRainMinutes = null // no DWD rain
    module.runtimeData.hourlyRainHours = 1.5 // hourly says rain in 1.5h (should be ignored)

    evaluateVisibility(module)

    // threshold=2 is not > 2 → hourly check skipped → hide
    assert.equal(module.runtimeData.isHiddenDueToNoRain, true, 'hourly should be ignored for threshold <= 2')
    assert.equal(module._calls.hide.length, 1)
  })

  test('threshold = 0: hides when DWD shows no rain now', () => {
    const module = createMockModule({ displayHoursBeforeRain: 0 })
    module.runtimeData.dwdRainMinutes = null // no rain currently

    evaluateVisibility(module)

    assert.equal(module.runtimeData.isHiddenDueToNoRain, true)
    assert.equal(module._calls.hide.length, 1)
  })

  test('threshold = 0: shows when DWD confirms rain right now', () => {
    const module = createMockModule({ displayHoursBeforeRain: 0 })
    module.runtimeData.dwdRainMinutes = 0 // rain now
    module.runtimeData.isHiddenDueToNoRain = true

    evaluateVisibility(module)

    assert.equal(module.runtimeData.isHiddenDueToNoRain, false)
    assert.equal(module._calls.show.length, 1)
  })

  test('threshold = 0: hides when DWD predicts rain in future (not now)', () => {
    const module = createMockModule({ displayHoursBeforeRain: 0 })
    module.runtimeData.dwdRainMinutes = 5 // rain in 5 min — not currently raining

    evaluateVisibility(module)

    // dwdWindowMin = min(0*60, 120) = 0; 5 > 0 → not shown
    assert.equal(module.runtimeData.isHiddenDueToNoRain, true, 'threshold=0 only shows for rain right now')
    assert.equal(module._calls.hide.length, 1)
  })
})

describe('Carousel compatibility', () => {
  test('state remains independent when Carousel clears animation timer', () => {
    const module = createMockModule({ displayHoursBeforeRain: 0 })

    // Module is shown because of rain
    module.runtimeData.isHiddenDueToNoRain = false
    module.runtimeData.animationTimer = setTimeout(() => {}, 1000)

    // Carousel calls suspend() which clears the timer
    clearTimeout(module.runtimeData.animationTimer)
    module.runtimeData.animationTimer = null

    // Next weather update with rain should not re-show (already visible)
    handleCurrentWeatherCondition(module, 'rain')

    assert.equal(module._calls.show.length, 0, 'should not call show() when already visible despite timer being null')
    assert.equal(module.runtimeData.isHiddenDueToNoRain, false, 'state should remain unchanged')
  })

  test('module can be shown after being hidden by Carousel if rain detected', () => {
    const module = createMockModule({ displayHoursBeforeRain: 0 })

    // Module was hidden due to no rain
    module.runtimeData.isHiddenDueToNoRain = true
    module.runtimeData.animationTimer = null

    // Carousel might have called hide() independently, but that doesn't affect our flag

    // Rain is detected
    handleCurrentWeatherCondition(module, 'rain')

    assert.equal(module._calls.show.length, 1, 'should show module when rain detected')
    assert.equal(module.runtimeData.isHiddenDueToNoRain, false)
    assert.equal(module._calls.play.length, 1, 'should restart animation')
  })

  test('multiple rapid weather updates do not cause redundant show/hide calls', () => {
    const module = createMockModule({ displayHoursBeforeRain: 0 })

    // First update - no rain (hide)
    handleCurrentWeatherCondition(module, '')
    assert.equal(module._calls.hide.length, 1)

    // Second update - still no rain (should not hide again)
    handleCurrentWeatherCondition(module, '')
    assert.equal(module._calls.hide.length, 1, 'should not hide again')

    // Third update - rain detected (show)
    handleCurrentWeatherCondition(module, 'rain')
    assert.equal(module._calls.show.length, 1)

    // Fourth update - still rain (should not show again)
    handleCurrentWeatherCondition(module, 'rain')
    assert.equal(module._calls.show.length, 1, 'should not show again')
  })
})

describe('rainConditions validation', () => {
  test('rainConditions array is not empty', () => {
    assert.ok(rainConditions.length > 0, 'rainConditions should contain weather codes')
  })

  test('rainConditions includes common rain codes', () => {
    const expectedCodes = ['rain', 'showers', 'thunderstorm', 'snow', 'sleet']
    expectedCodes.forEach((code) => {
      assert.ok(
        rainConditions.some((c) => c.includes(code)),
        `rainConditions should include "${code}"`
      )
    })
  })
})
