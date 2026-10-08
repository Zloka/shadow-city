import type { Position } from 'geojson'

/** Straight-line distance in metres; accurate enough within a city. */
export function distanceInMetres([lng0, lat0]: Position, [lng, lat]: Position): number {
  const x = (lng - lng0) * 111_320 * Math.cos((lat0 * Math.PI) / 180)
  const y = (lat - lat0) * 110_574
  return Math.hypot(x, y)
}
