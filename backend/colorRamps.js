// Color ramps map a precipitation rate in mm/h to an RGBA color.
// Stops are (mmPerHour, [r,g,b,a]) pairs; colors are linearly interpolated
// between consecutive stops, clamped at the ends. alpha 0 = fully transparent.

const RAMPS = {
  blue: [
    [0, [0, 0, 0, 0]], // kein Niederschlag
    [0.2, [120, 190, 240, 60]], // sehr leichter Regen
    [1, [70, 150, 230, 140]], // leichter Regen
    [4, [40, 110, 220, 190]], // mäßiger Regen
    [10, [30, 80, 200, 220]], // starker Regen
    [25, [40, 40, 180, 240]], // sehr starker Regen
    [50, [90, 20, 160, 255]], // extremer Regen
    [100, [150, 10, 120, 255]] // extremer Regen (Unwetter)
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
  ],
  // Abgeleitet aus der DWD-Radar-dBZ-Farbskala (Warnwetter-App-Palette,
  // vgl. https://www.dwd.de/DE/wetter/thema_des_tages/2024/1/6.html).
  // mm/h-Werte bis 46 dBZ per operationeller Z-R-Beziehung berechnet
  // (Aniol/Doelling: Z = 256 * R^1.42, in Deutschland Standard).
  // Ab 50,5 dBZ liefert die Z-R-Formel keine sinnvollen Regenraten mehr,
  // da hohe Reflektivität dort meist Hagel statt Regen anzeigt (siehe DWD-Text:
  // ">55 dBZ meist Hagel"). Diese oberen Stufen sind daher gestaucht/gekappt
  // statt exponentiell extrapoliert (rechnerisch wären es 150-3850+ mm/h).
  dwd: [
    [0, [0, 0, 0, 0]], // kein Echo
    [0.02, [190, 240, 250, 50]], // 1-5.5 dBZ – Sprühregen, ein paar Tropfen
    [0.05, [90, 210, 220, 90]], // 5.5-10 dBZ – leichter Regen
    [0.1, [20, 150, 140, 120]], // 10-14.5 dBZ – leichter/mäßiger Landregen
    [0.2, [20, 130, 60, 150]], // 14.5-19 dBZ – mäßiger Landregen
    [0.44, [70, 170, 70, 175]], // 19-23.5 dBZ – mäßiger Regen
    [0.9, [140, 195, 60, 195]], // 23.5-28 dBZ – kräftigerer Regen
    [1.9, [190, 210, 50, 210]], // 28-32.5 dBZ – Übergang zu Schauern
    [3.9, [255, 230, 40, 225]], // 32.5-37 dBZ – kräftige Schauer (Gelb-Beginn)
    [8, [245, 165, 30, 235]], // 37-41.5 dBZ – kräftige Schauer/Gewitter
    [17, [230, 110, 20, 245]], // 41.5-46 dBZ – starke Schauer
    [35, [230, 20, 20, 250]], // 46-50.5 dBZ – Starkregen (Rot-Beginn, >45 dBZ)
    [60, [140, 0, 0, 255]], // 50.5-55 dBZ – sehr starker Starkregen, gekappt
    [80, [60, 100, 220, 255]], // 55-60 dBZ – Übergang, meist Hagelbeginn
    [100, [0, 0, 180, 255]], // 60-65 dBZ – Hagel wahrscheinlich
    [130, [140, 0, 140, 255]], // 65-75 dBZ – Hagel/Unwetter
    [170, [255, 0, 220, 255]] // 75-85 dBZ – extremes Unwetter/Großhagel
  ]
}

/**
 * @param {number} mmPerHour
 * @param {'blue'|'classic'|'violet'|'dwd'} scheme
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
