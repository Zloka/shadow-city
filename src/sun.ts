import type { LightSpecification, SkySpecification } from 'maplibre-gl'
import { getMoonIllumination, getMoonPosition, getPosition, getTimes } from 'suncalc'

export type Sun = {
  /** Degrees above the horizon; negative when the sun is down. */
  altitude: number
  /** Degrees clockwise from north. */
  azimuth: number
  /** Null when the sun does not rise or set on this day. */
  sunrise: Date | null
  sunset: Date | null
  /** Start of the evening golden hour. */
  goldenHour: Date | null
  /** The next sunrise after `date`: today's before dawn, otherwise tomorrow's. */
  nextSunrise: Date | null
  alwaysUp: boolean
  alwaysDown: boolean
}

export type Phase = 'day' | 'golden' | 'twilight' | 'night'

// Below this altitude civil twilight ends and the night tint reaches full strength.
const CIVIL_TWILIGHT = -6
const GOLDEN_HOUR = 6
const MAX_NIGHT_OPACITY = 0.45

// Shadows reach full strength once the sun is this high. Below it the direct light is
// weaker, so the contrast between sun and shade fades, down to MIN_SHADOW_STRENGTH.
const FULL_SHADOW_ALTITUDE = 15
const MIN_SHADOW_STRENGTH = 0.4
const MAX_SHADOW_OPACITY = 0.28

// Sunlit ground glows warm while the sun is below this altitude.
const GLOW_ALTITUDE = 10
const MAX_GLOW_OPACITY = 0.16

const NOON_LIGHT = '#ffffff'
// Kept pale: the light colour multiplies the building colour, and a saturated orange
// turns the slate-grey buildings brown.
const LOW_SUN_LIGHT = '#ffe6c7'
const NIGHT_LIGHT = '#9fb3d9'

export function getSun(date: Date, lat: number, lng: number): Sun {
  const { altitude, azimuth } = getPosition(date, lat, lng)
  // Pass the browser's UTC offset so the times belong to the selected calendar day.
  const times = getTimes(date, lat, lng, 0, -date.getTimezoneOffset())
  return {
    altitude,
    azimuth,
    sunrise: times.sunrise,
    sunset: times.sunset,
    goldenHour: times.goldenHour,
    nextSunrise: nextSunrise(date, lat, lng, times.sunrise),
    alwaysUp: times.alwaysUp ?? false,
    alwaysDown: times.alwaysDown ?? false,
  }
}

function nextSunrise(date: Date, lat: number, lng: number, sunrise: Date | null): Date | null {
  if (sunrise && date < sunrise) return sunrise
  const tomorrow = new Date(date)
  tomorrow.setDate(tomorrow.getDate() + 1)
  return getTimes(tomorrow, lat, lng, 0, -tomorrow.getTimezoneOffset()).sunrise
}

export type Moon = { altitude: number; azimuth: number; illumination: number }

export function getMoon(date: Date, lat: number, lng: number): Moon {
  const { altitude, azimuth } = getMoonPosition(date, lat, lng)
  return { altitude, azimuth, illumination: getMoonIllumination(date).fraction }
}

// Moonlight shadows: faint, strongest under a high full moon.
const MAX_MOON_SHADOW_OPACITY = 0.35

export function getMoonShadowOpacity({ altitude, illumination }: Moon): number {
  if (altitude <= 0) return 0
  return MAX_MOON_SHADOW_OPACITY * illumination * clamp(altitude / FULL_SHADOW_ALTITUDE, MIN_SHADOW_STRENGTH, 1)
}

export function getPhase(altitude: number): Phase {
  if (altitude >= GOLDEN_HOUR) return 'day'
  if (altitude >= 0) return 'golden'
  if (altitude >= CIVIL_TWILIGHT) return 'twilight'
  return 'night'
}

/** Light for the extruded buildings, shining from the sun's direction. */
export function getSunLight({ altitude, azimuth }: Sun): LightSpecification {
  if (altitude <= 0) {
    return { anchor: 'map', position: [1.5, azimuth, 80], color: NIGHT_LIGHT, intensity: 0.2 }
  }
  // Warm and soft near the horizon, white and stronger once the sun is high.
  const warmth = clamp(1 - altitude / 20, 0, 1)
  return {
    anchor: 'map',
    position: [1.5, azimuth, 90 - altitude],
    color: mixHex(NOON_LIGHT, LOW_SUN_LIGHT, warmth),
    intensity: 0.5 - 0.1 * warmth,
  }
}

export function getShadowOpacity(altitude: number): number {
  if (altitude <= 0) return 0
  const height = clamp(altitude / FULL_SHADOW_ALTITUDE, 0, 1)
  return MAX_SHADOW_OPACITY * (MIN_SHADOW_STRENGTH + (1 - MIN_SHADOW_STRENGTH) * height)
}

/** Opacity of the warm glow under the shadows, strongest just after sunrise and before sunset. */
export function getGlowOpacity(altitude: number): number {
  // Fade in over the first degree so the glow doesn't snap on at the horizon.
  const risen = clamp(altitude, 0, 1)
  return MAX_GLOW_OPACITY * risen * clamp(1 - altitude / GLOW_ALTITUDE, 0, 1)
}

/** Opacity of the dark tint drawn over the map, fading in through civil twilight. */
export function getNightOpacity(altitude: number): number {
  return MAX_NIGHT_OPACITY * clamp(altitude / CIVIL_TWILIGHT, 0, 1)
}

type SkyColors = { sky: string; horizon: string; fog: string }

// Sky colours at key sun altitudes; colours in between are blended.
const SKY_KEYFRAMES: [number, SkyColors][] = [
  [-12, { sky: '#0b1430', horizon: '#1e2747', fog: '#1e2747' }],
  [-4, { sky: '#2c3566', horizon: '#c0708a', fog: '#6f6487' }],
  [2, { sky: '#6f86c6', horizon: '#ffb27a', fog: '#f6dcc8' }],
  [12, { sky: '#7cb7e8', horizon: '#d8ecf8', fog: '#eef3f7' }],
]

/** Sky and horizon haze for the sun's altitude: blue by day, glowing at sunset, navy at night. */
export function getSky(altitude: number): SkySpecification {
  const upper = SKY_KEYFRAMES.findIndex(([keyAltitude]) => altitude <= keyAltitude)
  let colors: SkyColors
  if (upper === 0) colors = SKY_KEYFRAMES[0][1]
  else if (upper === -1) colors = SKY_KEYFRAMES[SKY_KEYFRAMES.length - 1][1]
  else {
    const [fromAltitude, from] = SKY_KEYFRAMES[upper - 1]
    const [toAltitude, to] = SKY_KEYFRAMES[upper]
    const amount = (altitude - fromAltitude) / (toAltitude - fromAltitude)
    colors = {
      sky: mixHex(from.sky, to.sky, amount),
      horizon: mixHex(from.horizon, to.horizon, amount),
      fog: mixHex(from.fog, to.fog, amount),
    }
  }
  return {
    'sky-color': colors.sky,
    'horizon-color': colors.horizon,
    'fog-color': colors.fog,
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.7,
    'fog-ground-blend': 0.6,
  }
}

export type ViewMode = 'free' | 'from-sun' | 'into-sun'

/** The steepest camera tilt the map allows; the sun's-eye view needs more than the default. */
export const MAX_PITCH = 85

/**
 * Camera for looking at the city from the sun (every visible surface is lit) or toward it
 * (every visible surface is in shade). Bearing is the direction the camera faces, so from
 * the sun it faces away from the sun's azimuth; the tilt matches the sun's height.
 */
export function getSunViewCamera(
  { altitude, azimuth }: Pick<Sun, 'altitude' | 'azimuth'>,
  mode: Exclude<ViewMode, 'free'>,
): { bearing: number; pitch: number } {
  const bearing = mode === 'from-sun' ? azimuth + 180 : azimuth
  const pitch = clamp(90 - Math.max(altitude, 0), 0, MAX_PITCH)
  return { bearing: ((bearing + 540) % 360) - 180, pitch }
}

const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

export function compassPoint(azimuth: number): string {
  const index = Math.round((((azimuth % 360) + 360) % 360) / 45) % COMPASS_POINTS.length
  return COMPASS_POINTS[index]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function mixHex(from: string, to: string, amount: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  const mixed = [0, 1, 2].map((i) =>
    Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * amount),
  )
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}
