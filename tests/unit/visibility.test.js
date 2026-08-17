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
      hourlyRainHours: undefined
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
 * Simplified version of _evaluateVisibility from Frontend.ts
 */
function evaluateVisibility(module) {
  const threshold = module.config.displayHoursBeforeRain
  const { dwdRainMinutes, hourlyRainHours } = module.runtimeData
  const dwdWindowMin = Math.min(threshold * 60, 120)

  if (dwdRainMinutes !== undefined && dwdRainMinutes !== null && dwdRainMinutes <= dwdWindowMin) {
    handleCurrentWeatherCondition(module, 'rain')
    return
  }

  if (threshold > 2 && hourlyRainHours !== undefined && hourlyRainHours > 2 && hourlyRainHours < threshold) {
    handleCurrentWeatherCondition(module, 'rain')
    return
  }

  const canHide = threshold <= 2 || hourlyRainHours !== undefined
  if (canHide) {
    handleCurrentWeatherCondition(module, '')
  }
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
 * Simplified version of handleWeatherUpdate from Frontend.ts
 */
function handleWeatherUpdate(module, update) {
  const dwdActive = module.runtimeData.dwdRainMinutes !== undefined

  if (!dwdActive) {
    const currentCondition = update.currentWeather?.weatherType
    if (currentCondition && rainConditions.some((condition) => currentCondition.includes(condition))) {
      handleCurrentWeatherCondition(module, 'rain')
      return
    }
  }

  const hourlyData = update.hourlyArray
  const minLookAheadMs = dwdActive ? 120 * 60 * 1000 : -60 * 60 * 1000
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

  const hoursToRain = closestRainMs / 1000 / 60 / 60

  if (dwdActive) {
    module.runtimeData.hourlyRainHours = hoursToRain
    evaluateVisibility(module)
  } else {
    if (hoursToRain < module.config.displayHoursBeforeRain) {
      handleCurrentWeatherCondition(module, 'rain')
    } else {
      handleCurrentWeatherCondition(module, '')
    }
  }
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
  test('hides module when rain is far in future', () => {
    const module = createMockModule({ displayHoursBeforeRain: 2 })
    const now = Date.now()

    const update = {
      hourlyArray: [
        { date: now + 1000 * 60 * 60 * 5, weatherType: 'rain' } // 5 hours in future
      ]
    }

    handleWeatherUpdate(module, update)

    assert.equal(module.runtimeData.isHiddenDueToNoRain, true, 'should hide when rain is > 2 hours away')
    assert.equal(module._calls.hide.length, 1)
  })

  test('shows module when rain is within threshold', () => {
    const module = createMockModule({ displayHoursBeforeRain: 2 })
    module.runtimeData.isHiddenDueToNoRain = true
    const now = Date.now()

    const update = {
      hourlyArray: [
        { date: now + 1000 * 60 * 60 * 1, weatherType: 'rain' } // 1 hour in future
      ]
    }

    handleWeatherUpdate(module, update)

    assert.equal(module.runtimeData.isHiddenDueToNoRain, false, 'should show when rain is < 2 hours away')
    assert.equal(module._calls.show.length, 1)
  })

  test('finds closest rain event from multiple entries', () => {
    const module = createMockModule({ displayHoursBeforeRain: 2 })
    module.runtimeData.isHiddenDueToNoRain = true
    const now = Date.now()

    const update = {
      hourlyArray: [
        { date: now + 1000 * 60 * 60 * 10, weatherType: 'clear' },
        { date: now + 1000 * 60 * 60 * 5, weatherType: 'rain' }, // 5 hours
        { date: now + 1000 * 60 * 60 * 1.5, weatherType: 'rain' }, // 1.5 hours - closest
        { date: now + 1000 * 60 * 60 * 8, weatherType: 'thunderstorm' }
      ]
    }

    handleWeatherUpdate(module, update)

    // Closest rain is 1.5 hours, which is < 2 hours threshold
    assert.equal(module.runtimeData.isHiddenDueToNoRain, false, 'should use closest rain event')
    assert.equal(module._calls.show.length, 1)
  })

  test('hides module when no rain predicted', () => {
    const module = createMockModule({ displayHoursBeforeRain: 2 })
    const now = Date.now()

    const update = {
      hourlyArray: [
        { date: now + 1000 * 60 * 60 * 1, weatherType: 'clear' },
        { date: now + 1000 * 60 * 60 * 2, weatherType: 'cloudy' },
        { date: now + 1000 * 60 * 60 * 3, weatherType: 'sunny' }
      ]
    }

    handleWeatherUpdate(module, update)

    assert.equal(module.runtimeData.isHiddenDueToNoRain, true, 'should hide when no rain predicted')
    assert.equal(module._calls.hide.length, 1)
  })

  test('handles empty hourly array', () => {
    const module = createMockModule({ displayHoursBeforeRain: 2 })

    const update = {
      hourlyArray: []
    }

    handleWeatherUpdate(module, update)

    assert.equal(module.runtimeData.isHiddenDueToNoRain, true, 'should hide when no data available')
    assert.equal(module._calls.hide.length, 1)
  })

  test('shows module when currently raining even if hourly forecast has no upcoming rain', () => {
    // Regression: displayHoursBeforeRain: 2 must show the module when it's currently raining,
    // even if the hourly forecast shows no rain in the next 2 hours (e.g. rain ending soon,
    // or provider does not include the current hour in hourlyArray).
    const module = createMockModule({ displayHoursBeforeRain: 2 })
    module.runtimeData.isHiddenDueToNoRain = true
    const now = Date.now()

    const update = {
      currentWeather: { weatherType: 'rain' },
      hourlyArray: [
        { date: now + 1000 * 60 * 60 * 1, weatherType: 'clear' },
        { date: now + 1000 * 60 * 60 * 2, weatherType: 'clear' },
        { date: now + 1000 * 60 * 60 * 3, weatherType: 'clear' }
      ]
    }

    handleWeatherUpdate(module, update)

    assert.equal(module.runtimeData.isHiddenDueToNoRain, false, 'should show when currently raining')
    assert.equal(module._calls.show.length, 1)
  })

  test('shows module when currently raining using openweathermap icon code', () => {
    const module = createMockModule({ displayHoursBeforeRain: 2 })
    module.runtimeData.isHiddenDueToNoRain = true
    const now = Date.now()

    const update = {
      currentWeather: { weatherType: '10d' },
      hourlyArray: [{ date: now + 1000 * 60 * 60 * 3, weatherType: 'clear' }]
    }

    handleWeatherUpdate(module, update)

    assert.equal(module.runtimeData.isHiddenDueToNoRain, false, 'should recognize icon codes as rain')
    assert.equal(module._calls.show.length, 1)
  })

  test('does not show module when past rain exists but no upcoming rain', () => {
    // Regression: past rain entries in hourlyArray must not falsely trigger the module.
    const module = createMockModule({ displayHoursBeforeRain: 2 })
    const now = Date.now()

    const update = {
      currentWeather: { weatherType: 'clear' },
      hourlyArray: [
        { date: now - 1000 * 60 * 60 * 5, weatherType: 'rain' }, // 5 hours ago
        { date: now + 1000 * 60 * 60 * 3, weatherType: 'clear' },
        { date: now + 1000 * 60 * 60 * 4, weatherType: 'clear' }
      ]
    }

    handleWeatherUpdate(module, update)

    assert.equal(module.runtimeData.isHiddenDueToNoRain, true, 'should not react to past rain')
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

describe('DWD nowcast rain forecast (handleDwdRainForecast + _evaluateVisibility)', () => {
  test('shows module when DWD reports rain right now (minutesUntilRain=0)', () => {
    const module = createMockModule({ displayHoursBeforeRain: 1 })
    module.runtimeData.isHiddenDueToNoRain = true

    handleDwdRainForecast(module, { minutesUntilRain: 0, locationOutsideCoverage: false })

    assert.equal(module.runtimeData.isHiddenDueToNoRain, false, 'should show when currently raining')
    assert.equal(module._calls.show.length, 1)
  })

  test('shows module when DWD predicts rain within threshold window', () => {
    const module = createMockModule({ displayHoursBeforeRain: 1 })
    module.runtimeData.isHiddenDueToNoRain = true

    handleDwdRainForecast(module, { minutesUntilRain: 45, locationOutsideCoverage: false })

    assert.equal(module.runtimeData.isHiddenDueToNoRain, false, 'rain in 45 min is within 1h threshold')
    assert.equal(module._calls.show.length, 1)
  })

  test('hides module when DWD predicts no rain within 1h threshold', () => {
    const module = createMockModule({ displayHoursBeforeRain: 1 })

    handleDwdRainForecast(module, { minutesUntilRain: null, locationOutsideCoverage: false })

    assert.equal(module.runtimeData.isHiddenDueToNoRain, true, 'should hide when no rain in 120 min')
    assert.equal(module._calls.hide.length, 1)
  })

  test('hides module when DWD predicts rain beyond threshold', () => {
    const module = createMockModule({ displayHoursBeforeRain: 1 })

    // Rain in 90 min > 1h threshold (60 min)
    handleDwdRainForecast(module, { minutesUntilRain: 90, locationOutsideCoverage: false })

    assert.equal(module.runtimeData.isHiddenDueToNoRain, true, 'rain beyond threshold should hide module')
    assert.equal(module._calls.hide.length, 1)
  })

  test('does nothing when location is outside DWD coverage', () => {
    const module = createMockModule({ displayHoursBeforeRain: 1 })

    handleDwdRainForecast(module, { minutesUntilRain: null, locationOutsideCoverage: true })

    assert.equal(module._calls.hide.length, 0, 'should not hide when outside coverage')
    assert.equal(module._calls.show.length, 0)
    assert.equal(module.runtimeData.dwdRainMinutes, undefined, 'dwdRainMinutes should stay undefined')
  })

  test('does nothing when displayHoursBeforeRain is -1', () => {
    const module = createMockModule({ displayHoursBeforeRain: -1 })

    handleDwdRainForecast(module, { minutesUntilRain: 0, locationOutsideCoverage: false })

    assert.equal(module._calls.show.length, 0)
    assert.equal(module._calls.hide.length, 0)
  })

  test('DWD is authoritative for 0-120 min: overrides imprecise hourly for short window', () => {
    // Scenario that triggered the bug report: it rains outside but hourly shows rain 1.5h away.
    // DWD (lead=0) should detect current rain and show the module.
    const module = createMockModule({ displayHoursBeforeRain: 2 })
    module.runtimeData.isHiddenDueToNoRain = true

    // DWD says: raining right now
    handleDwdRainForecast(module, { minutesUntilRain: 0, locationOutsideCoverage: false })

    assert.equal(module.runtimeData.isHiddenDueToNoRain, false, 'DWD current rain must show module')
    assert.equal(module._calls.show.length, 1)
  })

  test('for threshold > 2h: uses hourly for >120 min portion when DWD shows no rain', () => {
    const module = createMockModule({ displayHoursBeforeRain: 3 })
    module.runtimeData.isHiddenDueToNoRain = true

    // DWD says no rain in 0-120 min
    handleDwdRainForecast(module, { minutesUntilRain: null, locationOutsideCoverage: false })
    // Module should not yet hide: hourly data has not arrived (threshold > 2h)
    assert.equal(module._calls.hide.length, 0, 'should wait for hourly data before hiding when threshold > 2h')

    // Hourly arrives: rain in 2.5h (beyond DWD window, within 3h threshold)
    const now = Date.now()
    handleWeatherUpdate(module, {
      hourlyArray: [{ date: now + 2.5 * 60 * 60 * 1000, weatherType: 'rain' }]
    })

    assert.equal(module.runtimeData.isHiddenDueToNoRain, false, 'hourly rain at 2.5h should show module')
    assert.equal(module._calls.show.length, 1)
  })

  test('for threshold > 2h: hides when both DWD and hourly confirm no rain', () => {
    const module = createMockModule({ displayHoursBeforeRain: 3 })

    // DWD says no rain in 0-120 min
    handleDwdRainForecast(module, { minutesUntilRain: null, locationOutsideCoverage: false })
    assert.equal(module._calls.hide.length, 0, 'should not hide yet; hourly data pending')

    // Hourly arrives: no rain in the 2-3h range either
    const now = Date.now()
    handleWeatherUpdate(module, {
      hourlyArray: [
        { date: now + 2.5 * 60 * 60 * 1000, weatherType: 'clear' },
        { date: now + 3.5 * 60 * 60 * 1000, weatherType: 'clear' }
      ]
    })

    assert.equal(module.runtimeData.isHiddenDueToNoRain, true, 'should hide when both sources confirm no rain')
    assert.equal(module._calls.hide.length, 1)
  })

  test('hourly entries within 120 min are skipped when DWD is active', () => {
    // Scenario: hourly says rain in 1h but DWD says no rain in 0-120 min.
    // DWD is more accurate so hourly's 1h entry should be ignored.
    const module = createMockModule({ displayHoursBeforeRain: 2 })

    // Activate DWD: no rain
    handleDwdRainForecast(module, { minutesUntilRain: null, locationOutsideCoverage: false })

    // Hourly says rain in 1h (within DWD's window — should be skipped)
    const now = Date.now()
    handleWeatherUpdate(module, {
      hourlyArray: [{ date: now + 1 * 60 * 60 * 1000, weatherType: 'rain' }]
    })

    assert.equal(
      module.runtimeData.isHiddenDueToNoRain,
      true,
      'hourly rain within 120 min must not override DWD when DWD is active'
    )
  })

  test('displayHoursBeforeRain=0 with DWD: shows when raining now, hides when not', () => {
    const moduleRaining = createMockModule({ displayHoursBeforeRain: 0 })
    moduleRaining.runtimeData.isHiddenDueToNoRain = true
    handleDwdRainForecast(moduleRaining, { minutesUntilRain: 0, locationOutsideCoverage: false })
    assert.equal(moduleRaining.runtimeData.isHiddenDueToNoRain, false, 'DWD=0 min → show')

    const moduleNotRaining = createMockModule({ displayHoursBeforeRain: 0 })
    handleDwdRainForecast(moduleNotRaining, { minutesUntilRain: null, locationOutsideCoverage: false })
    assert.equal(moduleNotRaining.runtimeData.isHiddenDueToNoRain, true, 'DWD=null → hide')
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
