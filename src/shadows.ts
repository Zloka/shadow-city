import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson'
import type { ShadowCaster } from './osm'
import type { Sun } from './sun'

const METRES_PER_DEGREE_LAT = 110_574
const METRES_PER_DEGREE_LNG_AT_EQUATOR = 111_320

// Shadows lengthen without bound as the sun nears the horizon. Computing them as if the
// sun were at least this high caps them at about 29 times the building height.
export const MIN_SHADOW_ALTITUDE = 2

const NO_SHADOWS: FeatureCollection<MultiPolygon> = { type: 'FeatureCollection', features: [] }

const toRadians = (degrees: number) => (degrees * Math.PI) / 180

/**
 * Ground shadows as one MultiPolygon per caster. A prism's shadow is the area its footprint
 * sweeps between the shadows of its bottom and top, so it is the union of those two shifted
 * footprints and the parallelogram each wall sweeps. For a building the bottom is the ground,
 * so the first one is the footprint itself; a tree crown's shadow starts away from the trunk.
 * Overlaps are left in place because the map composites the shadow layer as one surface.
 */
export function computeShadows(
  casters: Feature<Polygon, ShadowCaster>[],
  { altitude, azimuth }: Pick<Sun, 'altitude' | 'azimuth'>,
): FeatureCollection<MultiPolygon> {
  // The same object every time, so nothing downstream sees a change while the sun is down.
  if (altitude <= 0) return NO_SHADOWS


  const lengthPerMetre = 1 / Math.tan(toRadians(Math.max(altitude, MIN_SHADOW_ALTITUDE)))
  // Shadows point away from the sun.
  const bearing = toRadians(azimuth + 180)
  const east = Math.sin(bearing) * lengthPerMetre
  const north = Math.cos(bearing) * lengthPerMetre

  const features = casters.map((caster): Feature<MultiPolygon> => {
    const footprint = caster.geometry.coordinates[0]
    const { height, base = 0 } = caster.properties
    const metresPerDegreeLng = METRES_PER_DEGREE_LNG_AT_EQUATOR * Math.cos(toRadians(footprint[0][1]))
    const shift = (metres: number) => {
      const dLng = (east * metres) / metresPerDegreeLng
      const dLat = (north * metres) / METRES_PER_DEGREE_LAT
      return footprint.map(([lng, lat]): Position => [lng + dLng, lat + dLat])
    }

    const bottom = base > 0 ? shift(base) : footprint
    const top = shift(height)
    // A convex shape's sweep is simply the outline around both ends: one polygon instead of
    // one per wall. Every tree crown and most rectangular buildings take this path.
    const polygons: Position[][][] = isConvex(footprint)
      ? [[convexHull([...bottom, ...top])]]
      : [[bottom], [top]]
    if (polygons.length > 1) {
      for (let i = 0; i < footprint.length - 1; i++) {
        polygons.push([[bottom[i], bottom[i + 1], top[i + 1], top[i], bottom[i]]])
      }
    }

    return {
      type: 'Feature',
      id: caster.id,
      properties: {},
      geometry: { type: 'MultiPolygon', coordinates: polygons },
    }
  })

  return { type: 'FeatureCollection', features }
}

/** Whether a closed ring turns the same way at every corner. */
function isConvex(ring: Position[]): boolean {
  let sign = 0
  const n = ring.length - 1
  for (let i = 0; i < n; i++) {
    const [ax, ay] = ring[i]
    const [bx, by] = ring[(i + 1) % n]
    const [cx, cy] = ring[(i + 2) % n]
    const turn = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
    if (turn === 0) continue
    if (sign === 0) sign = Math.sign(turn)
    else if (Math.sign(turn) !== sign) return false
  }
  return true
}

/** Closed convex hull ring of the points (Andrew's monotone chain). */
function convexHull(points: Position[]): Position[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const turn = (o: Position, a: Position, b: Position) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Position[] = []
  for (const point of sorted) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper: Position[] = []
  for (const point of sorted.reverse()) {
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop()
    upper.push(point)
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)]
  return [...hull, hull[0]]
}
