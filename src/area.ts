import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Bbox } from './osm'

/** Below this zoom the view covers too much city to load and draw in detail. */
export const MIN_DETAIL_ZOOM = 14

// Half the side of the largest area loaded at once. A tilted view can reach far toward the
// horizon, so the area is capped around the centre rather than following the visible bounds.
const MAX_HALF_SIZE_METRES = 1000
const METRES_PER_DEGREE_LAT = 110_574
const METRES_PER_DEGREE_LNG_AT_EQUATOR = 111_320

/** The area around the map centre covering the view scaled by `scale`, capped in size. */
export function areaAround(map: MapLibreMap, scale: number): Bbox {
  const { lng, lat } = map.getCenter()
  const bounds = map.getBounds()
  const metresPerDegreeLng = METRES_PER_DEGREE_LNG_AT_EQUATOR * Math.cos((lat * Math.PI) / 180)
  const halfLng = Math.min(
    Math.max(bounds.getEast() - lng, lng - bounds.getWest()) * scale,
    MAX_HALF_SIZE_METRES / metresPerDegreeLng,
  )
  const halfLat = Math.min(
    Math.max(bounds.getNorth() - lat, lat - bounds.getSouth()) * scale,
    MAX_HALF_SIZE_METRES / METRES_PER_DEGREE_LAT,
  )
  return [lat - halfLat, lng - halfLng, lat + halfLat, lng + halfLng]
}

export function containsArea(outer: Bbox, inner: Bbox): boolean {
  return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3]
}
