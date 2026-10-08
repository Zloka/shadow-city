import type { Feature, Polygon, Position } from 'geojson'
import { getPosition } from 'suncalc'
import type { ShadowCaster } from './osm'
import { MIN_SHADOW_ALTITUDE } from './shadows'

const METRES_PER_DEGREE_LAT = 110_574
const METRES_PER_DEGREE_LNG_AT_EQUATOR = 111_320
const CELL_SIZE = 50
const MAX_RAY_LENGTH = 2000
// How far outside the façade a place mapped inside a building is assumed to be.
const FACADE_OFFSET = 1

const toRadians = (degrees: number) => (degrees * Math.PI) / 180

type Vec = [number, number]

/** A building or a tree crown that can block the sun. */
type Obstacle = {
  /** Footprint in metres east and north of the index origin. */
  ring: Vec[]
  height: number
  /** Height of the obstacle's underside: 0 for buildings, the crown's bottom for trees. */
  base: number
  /** Buildings are solid; places can be inside them but not inside a tree crown. */
  solid: boolean
  min: Vec
  max: Vec
}

/** Shadow casters in local metric coordinates, bucketed into a grid for ray casting. */
export type SunIndex = {
  origin: Position
  metresPerDegreeLng: number
  obstacles: Obstacle[]
  cells: Map<number, number[]>
  maxHeight: number
}

export type SunState = 'sun' | 'shade' | 'night'

export type TimelineSegment = { start: Date; end: Date; state: SunState }

/** Indexes buildings and tree crowns; casters with a `part` property are tree crowns. */
export function createSunIndex(casters: Feature<Polygon, ShadowCaster & { part?: string }>[]): SunIndex {
  const origin = casters[0]?.geometry.coordinates[0][0] ?? [0, 0]
  const index: SunIndex = {
    origin,
    metresPerDegreeLng: METRES_PER_DEGREE_LNG_AT_EQUATOR * Math.cos(toRadians(origin[1])),
    obstacles: [],
    cells: new Map(),
    maxHeight: 0,
  }

  for (const caster of casters) {
    const ring = caster.geometry.coordinates[0].map((position) => toLocal(index, position))
    const xs = ring.map(([x]) => x)
    const ys = ring.map(([, y]) => y)
    const indexed: Obstacle = {
      ring,
      height: caster.properties.height,
      base: caster.properties.base ?? 0,
      solid: caster.properties.part === undefined,
      min: [Math.min(...xs), Math.min(...ys)],
      max: [Math.max(...xs), Math.max(...ys)],
    }
    const id = index.obstacles.push(indexed) - 1
    index.maxHeight = Math.max(index.maxHeight, indexed.height)

    for (let cx = cellOf(indexed.min[0]); cx <= cellOf(indexed.max[0]); cx++) {
      for (let cy = cellOf(indexed.min[1]); cy <= cellOf(indexed.max[1]); cy++) {
        const key = cellKey(cx, cy)
        const cell = index.cells.get(key)
        if (cell) cell.push(id)
        else index.cells.set(key, [id])
      }
    }
  }
  return index
}

/**
 * Whether a place is in direct sunlight: a ray from it toward the sun must not pass through
 * a building taller than the ray at that point. This matches the drawn shadows exactly.
 */
export function getSunState(
  index: SunIndex,
  position: Position,
  altitude: number,
  azimuth: number,
): SunState {
  if (altitude <= 0) return 'night'

  let start = toLocal(index, position)
  // Places mapped inside a building, like most cafés, are treated as being at its nearest façade.
  const host = buildingsAt(index, start)[0]
  if (host !== undefined) start = toFacade(index, index.obstacles[host].ring, start)
  // If every wall is shared with a neighbour, the point is still inside one. That building
  // can't block the ray, or the place would always read as shaded.
  const ignored = new Set(buildingsAt(index, start))

  const tanAltitude = Math.tan(toRadians(Math.max(altitude, MIN_SHADOW_ALTITUDE)))
  const direction: Vec = [Math.sin(toRadians(azimuth)), Math.cos(toRadians(azimuth))]
  const length = Math.min(index.maxHeight / tanAltitude, MAX_RAY_LENGTH)

  // Walk the ray outwards a cell at a time, so nearby buildings are tested first.
  const tested = new Set(ignored)
  for (let travelled = 0; travelled <= length + CELL_SIZE; travelled += CELL_SIZE) {
    const cx = cellOf(start[0] + direction[0] * travelled)
    const cy = cellOf(start[1] + direction[1] * travelled)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const id of index.cells.get(cellKey(cx + dx, cy + dy)) ?? []) {
          if (tested.has(id)) continue
          tested.add(id)
          const obstacle = index.obstacles[id]
          const hits = hitRange(obstacle.ring, start, direction)
          // Blocked if the ray is between the obstacle's underside and top somewhere inside it.
          // For buildings that is where the ray enters; under a tree crown a low sun gets through.
          if (
            hits &&
            hits.near <= length &&
            hits.near * tanAltitude <= obstacle.height &&
            hits.far * tanAltitude >= obstacle.base
          ) {
            return 'shade'
          }
        }
      }
    }
  }
  return 'sun'
}

/** Sun and shade through the calendar day of `date`, sampled every `stepMinutes`. */
export function getDayTimeline(
  index: SunIndex,
  position: Position,
  date: Date,
  stepMinutes = 10,
): TimelineSegment[] {
  const [lng, lat] = position
  const segments: TimelineSegment[] = []
  const dayStart = new Date(date)
  dayStart.setHours(0, 0, 0, 0)

  for (let minutes = 0; minutes < 24 * 60; minutes += stepMinutes) {
    const start = new Date(dayStart)
    start.setMinutes(minutes)
    const end = new Date(dayStart)
    end.setMinutes(minutes + stepMinutes)
    // Judge each step by its midpoint.
    const middle = new Date((start.getTime() + end.getTime()) / 2)
    const { altitude, azimuth } = getPosition(middle, lat, lng)
    const state = getSunState(index, position, altitude, azimuth)

    const previous = segments[segments.length - 1]
    if (previous?.state === state) previous.end = end
    else segments.push({ start, end, state })
  }
  return segments
}

const MAX_CACHED_TIMELINES = 2000
const timelineCache = new WeakMap<SunIndex, Map<string, TimelineSegment[]>>()

/**
 * A place's timeline only changes with the calendar day, so it is computed once per day and
 * reused while the time moves. The cache goes with the index when a new area loads.
 */
export function getCachedDayTimeline(index: SunIndex, position: Position, date: Date): TimelineSegment[] {
  let cache = timelineCache.get(index)
  if (!cache) {
    cache = new Map()
    timelineCache.set(index, cache)
  }
  const key = `${position[0]},${position[1]},${date.toDateString()}`
  let timeline = cache.get(key)
  if (!timeline) {
    // A time-lapse running for many days would otherwise keep adding entries.
    if (cache.size >= MAX_CACHED_TIMELINES) cache.clear()
    timeline = getDayTimeline(index, position, date)
    cache.set(key, timeline)
  }
  return timeline
}

/** The segment of the timeline that contains `date`. */
export function segmentAt(timeline: TimelineSegment[], date: Date): TimelineSegment | undefined {
  return timeline.find((segment) => segment.start <= date && date < segment.end)
}

/** The first sunny segment starting after `date`. */
export function nextSunAfter(timeline: TimelineSegment[], date: Date): TimelineSegment | undefined {
  return timeline.find((segment) => segment.state === 'sun' && segment.start > date)
}

export function sunMinutes(timeline: TimelineSegment[]): number {
  return timeline
    .filter((segment) => segment.state === 'sun')
    .reduce((total, segment) => total + (segment.end.getTime() - segment.start.getTime()) / 60_000, 0)
}

function toLocal(index: SunIndex, [lng, lat]: Position): Vec {
  return [
    (lng - index.origin[0]) * index.metresPerDegreeLng,
    (lat - index.origin[1]) * METRES_PER_DEGREE_LAT,
  ]
}

function cellOf(metres: number): number {
  return Math.floor(metres / CELL_SIZE)
}

/** A numeric grid key; string keys were a measurable cost in the ray-casting loop. Loaded
 * areas span well under 65,536 cells, so the key is unique. */
function cellKey(cx: number, cy: number): number {
  return cx * 65_536 + cy
}

function buildingsAt(index: SunIndex, point: Vec): number[] {
  const candidates = index.cells.get(cellKey(cellOf(point[0]), cellOf(point[1]))) ?? []
  return candidates.filter((id) => {
    const { ring, min, max, solid } = index.obstacles[id]
    if (!solid) return false
    const inBox = point[0] >= min[0] && point[0] <= max[0] && point[1] >= min[1] && point[1] <= max[1]
    return inBox && containsPoint(ring, point)
  })
}

function containsPoint(ring: Vec[], [x, y]: Vec): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * A point just outside the nearest wall that faces open ground. Walls shared with a
 * neighbouring building are skipped; if all of them are shared, the nearest wall is used.
 */
function toFacade(index: SunIndex, ring: Vec[], point: Vec): Vec {
  const outside: { point: Vec; distance: number }[] = []
  for (let i = 0; i < ring.length - 1; i++) {
    const wall = closestOnSegment(ring[i], ring[i + 1], point)
    const distance = Math.hypot(wall[0] - point[0], wall[1] - point[1])
    if (distance === 0) continue
    const scale = (distance + FACADE_OFFSET) / distance
    outside.push({
      point: [point[0] + (wall[0] - point[0]) * scale, point[1] + (wall[1] - point[1]) * scale],
      distance,
    })
  }
  outside.sort((a, b) => a.distance - b.distance)
  const open = outside.find((candidate) => buildingsAt(index, candidate.point).length === 0)
  return (open ?? outside[0])?.point ?? point
}

function closestOnSegment(a: Vec, b: Vec, p: Vec): Vec {
  const ab: Vec = [b[0] - a[0], b[1] - a[1]]
  const lengthSquared = ab[0] ** 2 + ab[1] ** 2
  if (lengthSquared === 0) return a
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / lengthSquared))
  return [a[0] + ab[0] * t, a[1] + ab[1] * t]
}

/**
 * Distances along the ray to where it first and last crosses the ring; `near` is 0 when the
 * ray starts inside it. Null when the ray never meets the ring.
 */
function hitRange(ring: Vec[], start: Vec, direction: Vec): { near: number; far: number } | null {
  let near = Infinity
  let far = -Infinity
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]
    const edge: Vec = [ring[i + 1][0] - a[0], ring[i + 1][1] - a[1]]
    const denominator = cross(direction, edge)
    if (Math.abs(denominator) < 1e-12) continue
    const toEdge: Vec = [a[0] - start[0], a[1] - start[1]]
    const distance = cross(toEdge, edge) / denominator
    const along = cross(toEdge, direction) / denominator
    if (distance >= 0 && along >= 0 && along <= 1) {
      near = Math.min(near, distance)
      far = Math.max(far, distance)
    }
  }
  if (far < 0) return null
  if (containsPoint(ring, start)) near = 0
  return { near, far }
}

function cross(a: Vec, b: Vec): number {
  return a[0] * b[1] - a[1] * b[0]
}
