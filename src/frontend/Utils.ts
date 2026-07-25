import * as Log from 'logger'
import { Marker, Config } from '../types/Config'
import { MMGlobal } from '../types/MagicMirror'

// Global or injected variable declarations
declare const MM: MMGlobal

const supportedIconColors = ['black', 'blue', 'gold', 'green', 'grey', 'orange', 'red', 'violet', 'yellow'] as const

export const rainConditions = [
  '09d',
  '09n',
  '10d',
  '10n',
  '11d',
  '11n',
  '13d',
  '13n',
  'showers',
  'thunderstorm',
  'sleet',
  'rain',
  'snow'
] as const

export function getIconColor(marker: Marker): string {
  return marker.color && supportedIconColors.includes(marker.color as (typeof supportedIconColors)[number])
    ? marker.color
    : 'red'
}

export function changeSubstituteModuleVisibility(show: boolean, config: Config, lockString: string): void {
  const substituteModules = config.substituteModules || config.substitudeModules || []
  if (substituteModules.length > 0) {
    try {
      for (const curr of substituteModules) {
        const substituteModule = MM.getModules().find((module: { name: string }) => module.name === curr)
        if (!substituteModule) {
          Log.warn(`No substitute module found with name ${curr}`)
          continue
        }
        if (show) {
          substituteModule.show(300, undefined, { lockString })
        } else {
          substituteModule.hide(300, undefined, { lockString })
        }
      }
    } catch (err) {
      Log.error(err)
    }
  }
}
