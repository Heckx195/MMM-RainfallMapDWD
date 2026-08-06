# MMM-RainfallMapDWD

A Rain Radar Map for the [MagicMirror²](https://magicmirror.builders/) platform, based on **official German Weather Service (Deutscher Wetterdienst / DWD) open radar data**, including a real ~2 hour precipitation **forecast**, not just a look back in time.

This module is a fork of [MMM-RAIN-MAP](https://github.com/jalibu/MMM-RAIN-MAP) by jalibu. The map rendering (Leaflet + OpenStreetMap), animation, timeline and weather-conditional show/hide behavior are unchanged; what changed is the data source and how the radar overlay is produced.

## Demos

<div align="center">
  <img src="./docs/demo1.gif" width="33%" style="margin-right: 50px;"> <img src="./docs/demo2.gif" width="33%">
</div>

> [!IMPORTANT]
> Because this module relies on DWD's RADOLAN RV radar product, it only has data coverage for **Germany** (plus a margin into neighboring countries covered by the DWD composite grid, [official coverage map (PDF)](https://www.dwd.de/DE/leistungen/radarprodukte/radarkomposit_rv.pdf?__blob=publicationFile)). Map positions outside that coverage area will show an empty/transparent radar overlay. If you need rain radar for other regions, use the original [MMM-RAIN-MAP](https://github.com/jalibu/MMM-RAIN-MAP), which is based on the globally available RainViewer API.

## Why a fork?

The original module used the free [RainViewer](https://www.rainviewer.com/) API. RainViewer discontinued nowcast (future) radar data from that API entirely as of January 1, 2026, so the map could only show the past. This fork replaces RainViewer with DWD's **RADOLAN RV** product (`opendata.dwd.de/weather/radar/composite/rv`), an official, free, key-less radar nowcast that combines the current analysis with a 120 minutes extrapolated forecast in customizable time steps.

Because DWD only publishes raw gridded data (no ready-made map tiles), a `node_helper.js` backend was added that downloads, decodes, reprojects and renders the radar data into PNG image overlays for Leaflet - see [How it works](#how-it-works) below.

## Contents

- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
  - [Configuration example](#configuration-example)
  - [Configuration options](#configuration-options)
- [Update the module](#update-the-module)
  - [Marker Object](#marker-object)
  - [MapPosition Object](#mapposition-object)
- [How it works](#how-it-works)
- [Contribution and Development](#contribution-and-development)
  - [Testing locally before deploying to a Raspberry Pi](#testing-locally-before-deploying-to-a-raspberry-pi)
  - [Tests](#tests)
- [Data source and attribution](#data-source-and-attribution)
- [Thanks to](#thanks-to)
- [License](#license)
- [Changelog](#changelog)

## Features

- Displays DWD RADOLAN RV radar data (past + ~2h forecast) on OpenStreetMap
  - A new snapshot is published by DWD every 5 minutes
  - History is backfilled immediately on startup from DWD's ~48h data retention window
- Option to place multiple markers on map
- Option for multiple, alternating map positions
- Option to only show in current rainy weather conditions. Works only together with [weather](https://github.com/MagicMirrorOrg/MagicMirror/tree/master/modules/default/weather) or [MMM-OpenWeatherForecast](https://github.com/jclarke0000/MMM-OpenWeatherForecast) as dependency.
- (Experimental) Option to hide other modules in case of rain in favor to get more space.



## Installation

Navigate to the `MagicMirror/modules` directory and clone this repository (the folder name must match the module name used in `config.js` exactly, including case - MagicMirror looks up modules by folder/file name, which is case-sensitive on Linux):

```sh
git clone https://github.com/Heckx195/MMM-RainfallMapDWD
cd MMM-RainfallMapDWD
npm install
```

## Configuration

### Configuration example

Add the module configuration into the `MagicMirror/config/config.js` file:

```javascript
    {
      module: "MMM-RainfallMapDWD",
      position: "top_left",
      config: {
        animationSpeedMs: 800,
        colorizeTime: true,
        defaultZoomLevel: 6,
        displayTime: true,
        displayTimeline: true,
        displayClockSymbol: true,
        displayHoursBeforeRain: -1,
        extraDelayLastFrameMs: 2000,
        extraDelayCurrentFrameMs: 5000,
        invertColors: false,
        markers: [
          { lat: 48.14, lng: 11.58, color: "red", size: "2x" },
          { lat: 48.86, lng: 2.35, color: "green" }
        ],
        mapPositions: [
          { lat: 48.14, lng: 11.58, zoom: 7, loops: 1 },
          { lat: 48.86, lng: 2.35, zoom: 5, loops: 2 },
          { lat: 49.15, lng: 6.154, zoom: 4, loops: 2 }
        ],
        mapUrl: "https://a.tile.openstreetmap.de/{z}/{x}/{y}.png",
        mapHeight: "420px", // must be a pixel value (no percent)
        mapWidth: "420px", // must be a pixel value (no percent)
        maxHistoryFrames: 6,
        maxForecastFrames: -1,
        substituteModules: [],
        pollingIntervalMinutes: 5,
        radarRasterScale: 1,
        // radarRasterWidth: 800, // advanced: fine-grained alternative to radarRasterScale above
        // radarRasterHeight: 873,
        radarColorScheme: "blue",
      },
    },
```

### Configuration options

| Option                     | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `animationSpeedMs`         | Determines how fast the frames are played. <br><br>**Type:** `int` <br> **Default value:** `800` (time per frame in milliseconds)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `colorizeTime`             | Set true, to colorize the timestamps. <br><br>**Type:** `boolean` <br> **Default value:** `true`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `defaultZoomLevel`         | Fallback/default zoom value that is used if it is not explicitly set in a MapPosition. Since the radar overlay is a plain image (not a zoom-dependent tile pyramid), any OpenStreetMap zoom level works; very high zoom will visibly upscale the ~1km-resolution radar overlay. <br><br>**Type:** `int` <br> **Default value:** `6`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `displayTime`              | Set true, to display the legend showing the time for each frame. <br><br>**Type:** `boolean` <br> **Default value:** `true`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `displayClockSymbol`       | Set true, to display a clock symbol as time prefix in the legend. <br><br>**Type:** `boolean` <br> **Default value:** `true`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `displayTimeline`          | Set true, to display a timeline in the legend. <br><br>**Type:** `boolean` <br> **Default value:** `true`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `displayHoursBeforeRain`   | This option allows to show or hide the map depending on the expected or current weather situation. Requires either the [weather](https://github.com/MagicMirrorOrg/MagicMirror/tree/master/modules/default/weather) or the [MMM-OpenWeatherForecast](https://github.com/jclarke0000/MMM-OpenWeatherForecast) module to be installed and configured, since MMM-RainfallMapDWD only reacts to their notifications and never fetches weather data itself.<br/><br/><b>`-1`</b> (default): map is always displayed, no weather module needed.<br/><b>`0`</b>: map shows up when the current condition is rain. Supported by both modules - `weather` needs `type: "current"` (listens for `CURRENTWEATHER_TYPE`), `MMM-OpenWeatherForecast` works out of the box (listens for `OPENWEATHER_FORECAST_WEATHER_UPDATE`).<br/><b>Greater than `0`</b>: map shows up when rain is expected within that many hours. Only supported by the `weather` module with `type: "hourly"` (listens for `WEATHER_UPDATED` and scans its `hourlyArray`) - `MMM-OpenWeatherForecast` does not support this mode.<br/><br/>**Type:** `number` <br> **Default value:** `-1` |
| `extraDelayLastFrameMs`    | Add an extra delay to pause the animation on the last frame.<br><br>**Type:** `int` <br> **Default value:** `2000` (time in milliseconds)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `extraDelayCurrentFrameMs` | Add an extra delay to pause the animation on the frame for the current weather situation.<br><br>**Type:** `int` <br> **Default value:** `5000` (time in milliseconds)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `invertColors`             | Option to invert the colors of the map tiles. Can be used to display the map in a kind of dark mode.<br><br>**Type:** `boolean` <br> **Default value:** `false`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `markers`                  | Optional list of markers on the map.<br> See examples and Markers-Object documentation below for details. <br><br>**Type:** `array[Marker]` <br> **Default value:** `Sample set`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `mapPositions`             | **Required:** List of zoom/center positions for the map.<br> See examples and MapPosition-Object documentation below for details.<br>💡 **Tip:** You can get the latitude and longitude for your location from the URL bar at [openstreetmap.org](https://www.openstreetmap.org/). <br><br>**Type:** `array[MapPosition]` <br> **Default value:** `Sample set`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `mapHeight`                | Height of the map. Must be string with pixels and "px" postfix. Percentage values won't work.<br><br>**Type:** `string` (pixels) <br> **Default value:** `'420px'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `mapWidth`                 | Width of the map. Must be a string with pixels and "px" postfix. Percentage values won't work.<br><br>**Type:** `string` (pixels) <br> **Default value:** `'420px'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `mapUrl`                   | Option to use an alternative map. In most cases you are fine with the default but you can find more maps [here](https://wiki.openstreetmap.org/wiki/Tile_servers).<br><br>**Type:** `string`<br> **Default value:** `'https://a.tile.openstreetmap.de/{z}/{x}/{y}.png'`<br>**Official OSM server:** `'https://tile.openstreetmap.org/{z}/{x}/{y}.png'`<br>**Alternative uncolored map:** `'https://tiles.wmflabs.org/bw-mapnik/{z}/{x}/{y}.png'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `maxHistoryFrames`         | Maximum number of history frames kept/rendered. There is one DWD snapshot every 5 minutes (or every `pollingIntervalMinutes`, see below). Setting this to 6 shows the last 30 minutes. If set to `-1`, it resolves to 2 hours worth of frames at the configured polling interval (not DWD's full ~48h retention - every frame has to be decoded/rendered locally, so unbounded history is deliberately not offered).<br><br>**Type:** `int` <br> **Default value:** `6`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `maxForecastFrames`        | Maximum number of forecast frames kept/rendered, in steps of `pollingIntervalMinutes`. `-1` = all available (up to DWD RV's ~2h/120min horizon), `0` = no forecast.<br><br>**Type:** `int` <br> **Default value:** `-1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `substituteModules`        | (Experimental) If `displayHoursBeforeRain` is set to `0` or higher, you can define a list of module names that are hidden in favor of the map. <br><br>**Type:** `array[string]` <br> **Default value:** `[]` <br> **Example:** `['MMM-Jast', 'calendar']`<br>Legacy alias: `substitudeModules` (deprecated)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `timeFormat`               | Option to override the MagicMirror's global time format to 12 or 24 for this module. <br><br>**Type:** `int` <br> **Default value:** `[Global Config]` or `24`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `pollingIntervalMinutes`   | How often `node_helper.js` polls DWD for new radar data, and the time step between forecast frames. Must be a positive multiple of `5` (DWD's native product interval) - e.g. set to `15` on weaker hardware (like a Raspberry Pi) to cut the decode/render workload to a third.<br><br>**Type:** `int` <br> **Default value:** `5`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `radarRasterScale`         | Simple CPU-load/sharpness knob: multiplies the default 800x873 DE1200 raster size (e.g. `0.5` = half resolution/lower CPU load, `2` = double resolution/sharper). Takes precedence over `radarRasterWidth`/`radarRasterHeight` when set.<br><br>**Type:** `float` <br> **Default value:** none (falls back to `radarRasterWidth`/`radarRasterHeight`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `radarRasterWidth`         | **Advanced** (prefer `radarRasterScale` unless you need exact control): width (pixels) of the rendered radar overlay image. Lower for less CPU load on weaker hardware, higher for a sharper image. Ignored if `radarRasterScale` is set.<br><br>**Type:** `int` <br> **Default value:** `800`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `radarRasterHeight`        | **Advanced** (prefer `radarRasterScale` unless you need exact control): height (pixels) of the rendered radar overlay image. Same trade-off as `radarRasterWidth`. Ignored if `radarRasterScale` is set.<br><br>**Type:** `int` <br> **Default value:** `873`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `radarColorScheme`         | Color ramp used to render precipitation intensity. `violet` uses magenta/purple tones instead of blue, so the overlay stays visually distinct from OpenStreetMap's light blue lakes/rivers. `dwd` mimics the official DWD Warnwetter-app radar legend (green → yellow → red → blue/magenta for hail/extreme). Note: the underlying radar data is a rain-rate value, not raw reflectivity, so `dwd`'s hail-range colors (blue/magenta at the top) are approximated from very high derived rain amounts rather than true hail detection.<br><br>**Type:** `'blue' \| 'classic' \| 'violet' \| 'dwd'`<br> **Default value:** `'blue'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Update the module

Just enter the module's directory, pull the update and install the dependencies:

```bash
cd ~/MagicMirror/modules/MMM-RainfallMapDWD
git pull
npm install
```

### Marker Object

Markers are **visual pin icons** placed on the map at specific coordinates. They are purely decorative and do not define the visible map area. A typical use case is marking your home and workplace so you can easily spot them while watching the rain radar.

| Option  | Description                                                                                                                               |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `lat`   | **Required:** Marker's latitude.<br><br>**Type:** `float`                                                                                 |
| `lng`   | **Required:** Marker's longitude.<br><br>**Type:** `float`                                                                                |
| `color` | Marker's color.<br><br>**Possible values:** `'black','blue','gold','green','grey','orange','red','violet','yellow'`<br>**Type:** `string` |
| `size`  | Marker's icon size. `'2x'` renders a larger pin (and shadow) for better visibility.<br><br>**Possible values:** `'normal','2x'`<br>**Default:** `'normal'`<br>**Type:** `string` |

### MapPosition Object

Map positions define the center of the **visible map area** and at what zoom level. The map cycles through all configured positions, staying at each one for the configured number of animation loops.

| Option  | Description                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `lat`   | **Required:** Position's latitude.<br><br>**Type:** `float`                                                                                 |
| `lng`   | **Required:** Position's longitude.<br><br>**Type:** `float`                                                                                |
| `zoom`  | Either set a zoom level or defaultZoomLevel is used.<br><br>**Type:** `number`                                                              |
| `loops` | Number of loops/ iterations until the map moves to the next position. If no number is set, a value of `1` is used.<br><br>**Type:** `number` |

## How it works

`node_helper.js` runs on a timer (`pollingIntervalMinutes`) and:

1. Downloads the latest `composite_rv_<timestamp>.tar` archive from `opendata.dwd.de` (ODIM_H5/HDF5 members, one per x-minute lead time out to +120 minutes).
2. Decodes each member (`backend/radolanHdf5Decoder.js`) into a physical mm-per-x-minutes grid.
3. Reprojects the grid (`backend/reprojector.js`) from DWD's polar-stereographic DE1200 grid into a plain lat/lon (Plate Carrée) raster, using [proj4](https://www.npmjs.com/package/proj4), so it lines up correctly as a rectangular overlay on the OpenStreetMap base map.
4. Renders it to a colorized, transparent-where-dry PNG (`backend/radarPngRenderer.js`).
5. Tracks the rolling history + latest forecast frame set (`backend/frameStore.js`) and pushes it to the frontend via a socket notification.

The frontend (`src/frontend/Frontend.ts`) places each frame as a Leaflet `ImageOverlay` and crossfades between them on a timer. The same animation/timeline mechanism of the original module is used for these tile layers.

On first startup, history is backfilled immediately from DWD's rolling ~48h archive instead of waiting for it to accumulate one poll cycle at a time.

## Contribution and Development

This module's frontend is written in TypeScript and compiled with Rollup; the source is in `/src`. Compile it with `node --run build`.

The DWD data pipeline (`node_helper.js` + `/backend`) is plain CommonJS Node.js, run directly without a build step.

### Testing locally before deploying to a Raspberry Pi

Both `node_helper.js` and the whole decode pipeline (`h5wasm`, `proj4`, `tar-stream`, `pngjs`) are pure JS/WASM with no native compilation step, so they behave identically on Windows/macOS/Linux dev machines and on a Raspberry Pi (ARM). To try the module locally against **live DWD data** before shipping to a Pi:

1. Clone [MagicMirror](https://github.com/MagicMirrorOrg/MagicMirror) core somewhere and run `npm install`.
2. Place/symlink this module's folder into its `modules/` directory as `MMM-RainfallMapDWD`.
3. From this module's folder, run `npm run demo` (uses `config.demo.js`, starts MagicMirror in server/dev mode without Electron).
4. Open `http://localhost:8080` in a browser.

### Tests

Run `node --run test` (lint + `node --test tests/unit/**/*.test.js`). Unit tests cover configuration defaults, utility functions, weather-conditional visibility, the color ramp, and `FrameStore`'s history/forecast bookkeeping. The DWD decode/reproject/render pipeline itself was verified manually against real downloaded DWD data (correct grid geometry, and synthetic-marker tests confirming Hamburg/Berlin/Cologne/Munich land at their correct relative positions after reprojection) rather than as an automated test, since it requires live network access to DWD.

Contribution for this module is welcome!

## Data source and attribution

Radar data: © [Deutscher Wetterdienst (DWD)](https://www.dwd.de/), published under the [Data Licence Germany - Attribution](https://www.govdata.de/dl-de/by-2-0) via DWD's [Open Data Server](https://www.dwd.de/EN/ourservices/opendata/opendata.html). DWD provides no uptime/SLA guarantee for this service.

## Thanks to

- [jalibu/MMM-RAIN-MAP](https://github.com/jalibu/MMM-RAIN-MAP), the project this module is forked from - the map rendering, animation and weather-conditional visibility logic originate there.
- [MMM-RAIN-RADAR by jojoduquartier](https://github.com/jojoduquartier/MMM-RAIN-RADAR) for inspiration (credited by the upstream project).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE.md) file for details.

## Changelog

All notable changes to this project will be documented in the [CHANGELOG.md](CHANGELOG.md) file.
