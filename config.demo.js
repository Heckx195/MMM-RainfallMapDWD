/**
 * Demo configuration for MMM-RainfallMapDWD module development
 * This config is used for testing the module in isolation
 *
 * Usage: node --run demo
 */

const config = {
  port: 8080,
  address: 'localhost',
  language: 'de',
  logLevel: ['INFO', 'LOG', 'WARN', 'ERROR'],
  timeFormat: 24,
  units: 'metric',

  modules: [
    {
      module: 'alert'
    },
    {
      module: 'clock',
      position: 'top_right',
      config: {
        timeFormat: 'HH:mm:ss'
      }
    },

    // Top Left: Berlin
    {
      module: 'MMM-RainfallMapDWD',
      position: 'top_left',
      config: {
        animationSpeedMs: 800,
        colorizeTime: true,
        defaultZoomLevel: 8,
        displayTime: true,
        displayTimeline: true,
        displayClockSymbol: true,
        displayHoursBeforeRain: -1,
        extraDelayLastFrameMs: 2000,
        extraDelayCurrentFrameMs: 5000,
        invertColors: false,
        markers: [
          { lat: 49.41, lng: 8.717, color: 'red' },
          { lat: 48.856, lng: 2.35, color: 'green' }
        ],
        mapPositions: [
          { lat: 49.41, lng: 8.717, zoom: 7, loops: 1 },
          { lat: 49.41, lng: 8.717, zoom: 5, loops: 2 },
          { lat: 48.856, lng: 2.35, zoom: 5, loops: 1 },
          { lat: 48.856, lng: 2.35, zoom: 7, loops: 2 },
          { lat: 49.15, lng: 6.154, zoom: 4, loops: 2 }
        ],
        mapUrl: 'https://a.tile.openstreetmap.de/{z}/{x}/{y}.png',
        mapHeight: '420px', // must be a pixel value (no percent)
        mapWidth: '420px', // must be a pixel value (no percent)
        maxHistoryFrames: 6,
        maxForecastFrames: -1,
        substituteModules: [],
        pollingIntervalMinutes: 5,
        radarRasterWidth: 800,
        radarRasterHeight: 873,
        radarColorScheme: 'blue'
      }
    }
  ]
}

/*************** DO NOT EDIT THE LINE BELOW ***************/
if (typeof module !== 'undefined') {
  module.exports = config
}
