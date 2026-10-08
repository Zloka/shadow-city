import { centroid } from '@turf/turf'
import type { Feature, FeatureCollection, Point, Polygon, Position } from 'geojson'

// Public Overpass servers are frequently overloaded; later entries are fallbacks. The main
// server has been timing out after several seconds, which every auto-load would wait for.
const OVERPASS_URLS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
]

const DEFAULT_HEIGHT = 9.6
const LEVEL_HEIGHT = 3.2

const DEFAULT_TREE_HEIGHT = 10
const DEFAULT_CROWN_DIAMETER = 6
// The crown starts this far up the tree; below it is bare trunk.
const CROWN_BASE_RATIO = 0.35
const TRUNK_HALF_WIDTH = 0.3
// Spacing of the trees drawn along a mapped tree row.
const TREE_ROW_SPACING = 8
const METRES_PER_DEGREE_LAT = 110_574
const METRES_PER_DEGREE_LNG_AT_EQUATOR = 111_320

/** Anything that casts a shadow: a prism from `base` (0 when omitted) up to `height` metres. */
export type ShadowCaster = {
  height: number
  base?: number
}

export type BuildingProperties = ShadowCaster & {
  estimated: boolean
  name: string | null
}

/** Trees are drawn as a trunk and a floating crown; only the crown casts shade. */
export type TreeProperties = ShadowCaster & {
  part: 'crown' | 'trunk'
}

export type PoiProperties = {
  /** Unique across element types, e.g. "node/123". */
  key: string
  name: string | null
  kind: string
} & PlaceDetails

/** Optional OSM tags shown in the place panel; null when the place doesn't have them. */
export type PlaceDetails = {
  openingHours: string | null
  cuisine: string | null
  outdoorSeating: boolean
  website: string | null
  phone: string | null
  address: string | null
  /** e.g. "fi:Kaivopuisto" */
  wikipedia: string | null
  /** e.g. "Q1757" */
  wikidata: string | null
}

export type OsmData = {
  buildings: FeatureCollection<Polygon, BuildingProperties>
  trees: FeatureCollection<Polygon, TreeProperties>
  pois: FeatureCollection<Point, PoiProperties>
}

/** South, west, north, east in degrees. */
export type Bbox = [number, number, number, number]

type Tags = Record<string, string>

type OverpassNode = {
  type: 'node'
  id: number
  lat: number
  lon: number
  tags?: Tags
}

type OverpassWay = {
  type: 'way'
  id: number
  // `out geom` can emit null for nodes it could not resolve.
  geometry?: ({ lat: number; lon: number } | null)[]
  tags?: Tags
}

type OverpassResponse = {
  elements: (OverpassNode | OverpassWay)[]
  remark?: string
}

const POI_TAG_PATTERNS: [string, RegExp][] = [
  ['amenity', /^(bench|cafe|restaurant|bar|biergarten)$/],
  ['leisure', /^(playground|picnic_table|outdoor_seating)$/],
  ['natural', /^beach$/],
  ['tourism', /^viewpoint$/],
]

function buildQuery([south, west, north, east]: Bbox): string {
  const bbox = [south, west, north, east].map((n) => n.toFixed(6)).join(',')
  return `[out:json][timeout:25];
(
  way["building"](${bbox});
  node["amenity"~"^(bench|cafe|restaurant|bar|biergarten)$"](${bbox});
  node["leisure"~"^(playground|picnic_table|outdoor_seating)$"](${bbox});
  node["natural"="beach"](${bbox});
  way["natural"="beach"](${bbox});
  node["tourism"="viewpoint"](${bbox});
  node["natural"="tree"](${bbox});
  way["natural"="tree_row"](${bbox});
);
out body geom;`
}

/** A failure caused by the server rather than the query, so another server may succeed. */
class ServerError extends Error {}

export async function fetchArea(bbox: Bbox, signal?: AbortSignal): Promise<OsmData> {
  const body = `data=${encodeURIComponent(buildQuery(bbox))}`
  const failures: string[] = []
  for (const url of OVERPASS_URLS) {
    try {
      return toGeoJson(await queryOverpass(url, body, signal))
    } catch (error) {
      if (!(error instanceof ServerError)) throw error
      failures.push(`${new URL(url).host}: ${error.message}`)
    }
  }
  throw new Error(`No Overpass server could answer. ${failures.join('; ')}`)
}

async function queryOverpass(
  url: string,
  body: string,
  signal?: AbortSignal,
): Promise<OverpassResponse> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new ServerError(error instanceof Error ? error.message : String(error))
  }

  if (!response.ok) {
    const status = `${response.status} ${response.statusText}`.trim()
    // 400 means the query itself is invalid, which no other server would accept either.
    if (response.status === 400) throw new Error(`Overpass rejected the query: ${status}`)
    throw new ServerError(status)
  }

  let json: OverpassResponse
  try {
    json = (await response.json()) as OverpassResponse
  } catch {
    throw new ServerError('Response was not valid JSON')
  }
  // Overpass reports runtime errors such as timeouts in `remark` with a 200 status.
  if (json.remark && /error/i.test(json.remark)) throw new ServerError(json.remark)
  return json
}

/** Everything that casts shade: buildings and tree crowns (trunks are too thin to matter). */
export function shadowCasters({ buildings, trees }: OsmData): Feature<Polygon, ShadowCaster & { part?: string }>[] {
  return [...buildings.features, ...trees.features.filter((tree) => tree.properties.part === 'crown')]
}

export function toGeoJson({ elements }: OverpassResponse): OsmData {
  const buildings: Feature<Polygon, BuildingProperties>[] = []
  const trees: Feature<Polygon, TreeProperties>[] = []
  const pois: Feature<Point, PoiProperties>[] = []

  for (const element of elements) {
    const tags = element.tags ?? {}
    const kind = poiKind(tags)

    if (element.type === 'node') {
      if (tags.natural === 'tree') trees.push(...treeFeatures([element.lon, element.lat], tags, element.id))
      if (kind) pois.push(poiFeature([element.lon, element.lat], tags, kind, element))
      continue
    }

    const coordinates = (element.geometry ?? [])
      .filter((point) => point !== null)
      .map((point): Position => [point.lon, point.lat])
    if (coordinates.length === 0) continue

    if (tags.natural === 'tree_row') {
      alongLine(coordinates, TREE_ROW_SPACING).forEach((position, i) =>
        trees.push(...treeFeatures(position, tags, element.id * 1000 + i)),
      )
    }

    if (tags.building) {
      const ring = closeRing(coordinates)
      if (ring.length >= 4) {
        buildings.push({
          type: 'Feature',
          id: element.id,
          geometry: { type: 'Polygon', coordinates: [ring] },
          properties: { ...buildingHeight(tags, ring), name: tags.name ?? null },
        })
      }
    }

    if (kind) {
      const center = centroid({ type: 'MultiPoint', coordinates })
      pois.push(poiFeature(center.geometry.coordinates, tags, kind, element))
    }
  }

  return {
    buildings: { type: 'FeatureCollection', features: buildings },
    trees: { type: 'FeatureCollection', features: trees },
    pois: { type: 'FeatureCollection', features: pois },
  }
}

const PERSON_HEIGHT = 1.8
const PERSON_HALF_WIDTH = 0.3

/** The user, standing at their location, so "Find me sun" shows their own shadow. */
export function personFeature(position: Position): Feature<Polygon, ShadowCaster & { part: 'person' }> {
  return {
    type: 'Feature',
    geometry: regularPolygon(position, PERSON_HALF_WIDTH, 4),
    properties: { part: 'person', height: PERSON_HEIGHT },
  }
}

/** A low-poly tree: an octagonal crown floating on a square trunk. */
function treeFeatures(center: Position, tags: Tags, id: number): Feature<Polygon, TreeProperties>[] {
  const height = parsePositive(tags.height) ?? DEFAULT_TREE_HEIGHT
  const crownRadius = (parsePositive(tags.diameter_crown) ?? DEFAULT_CROWN_DIAMETER) / 2
  const base = height * CROWN_BASE_RATIO
  return [
    { type: 'Feature', id, geometry: regularPolygon(center, crownRadius, 8), properties: { part: 'crown', height, base } },
    {
      type: 'Feature',
      id,
      geometry: regularPolygon(center, TRUNK_HALF_WIDTH, 4),
      properties: { part: 'trunk', height: base, base: 0 },
    },
  ]
}

function regularPolygon([lng, lat]: Position, radius: number, sides: number): Polygon {
  const dLat = radius / METRES_PER_DEGREE_LAT
  const dLng = radius / (METRES_PER_DEGREE_LNG_AT_EQUATOR * Math.cos((lat * Math.PI) / 180))
  const ring: Position[] = []
  for (let i = 0; i <= sides; i++) {
    const angle = ((i % sides) / sides) * 2 * Math.PI + Math.PI / sides
    ring.push([lng + Math.cos(angle) * dLng, lat + Math.sin(angle) * dLat])
  }
  return { type: 'Polygon', coordinates: [ring] }
}

/** Points every `spacing` metres along a line, starting at its first point. */
function alongLine(line: Position[], spacing: number): Position[] {
  const points: Position[] = []
  const metresPerDegreeLng = METRES_PER_DEGREE_LNG_AT_EQUATOR * Math.cos((line[0][1] * Math.PI) / 180)
  let untilNext = 0
  for (let i = 0; i < line.length - 1; i++) {
    const [lng0, lat0] = line[i]
    const [lng1, lat1] = line[i + 1]
    const length = Math.hypot((lng1 - lng0) * metresPerDegreeLng, (lat1 - lat0) * METRES_PER_DEGREE_LAT)
    let travelled = untilNext
    while (travelled <= length) {
      const t = length === 0 ? 0 : travelled / length
      points.push([lng0 + (lng1 - lng0) * t, lat0 + (lat1 - lat0) * t])
      travelled += spacing
    }
    untilNext = travelled - length
  }
  return points
}

function poiKind(tags: Tags): string | null {
  for (const [key, pattern] of POI_TAG_PATTERNS) {
    const value = tags[key]
    if (value && pattern.test(value)) return value
  }
  return null
}

function poiFeature(
  coordinates: Position,
  tags: Tags,
  kind: string,
  element: { type: string; id: number },
): Feature<Point, PoiProperties> {
  return {
    type: 'Feature',
    id: element.id,
    geometry: { type: 'Point', coordinates },
    properties: { key: `${element.type}/${element.id}`, name: tags.name ?? null, kind, ...placeDetails(tags) },
  }
}

function placeDetails(tags: Tags): PlaceDetails {
  const street = tags['addr:street']
  return {
    openingHours: tags.opening_hours ?? null,
    cuisine: tags.cuisine ?? null,
    outdoorSeating: tags.outdoor_seating === 'yes' || tags.outdoor_seating === 'terrace',
    website: tags.website ?? tags['contact:website'] ?? null,
    phone: tags.phone ?? tags['contact:phone'] ?? null,
    address: street ? [street, tags['addr:housenumber']].filter(Boolean).join(' ') : null,
    wikipedia: tags.wikipedia ?? null,
    wikidata: tags.wikidata ?? null,
  }
}

function closeRing(coordinates: Position[]): Position[] {
  const first = coordinates[0]
  const last = coordinates[coordinates.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) return coordinates
  return [...coordinates, first]
}

// Without a mapped height, small footprints are assumed to be low buildings: a backyard
// shed should not get the three storeys of a city block. Never above DEFAULT_HEIGHT.
const HEIGHT_BY_FOOTPRINT: [maxArea: number, height: number][] = [
  [30, 2.5],
  [80, LEVEL_HEIGHT],
  [150, 2 * LEVEL_HEIGHT],
]
// Building types that are low whatever their size, like a long row of garages.
const LOW_BUILDING_TYPES = new Set(['shed', 'garage', 'garages', 'carport', 'hut', 'kiosk'])
const LOW_BUILDING_HEIGHT = 3

function buildingHeight(tags: Tags, ring: Position[]): Omit<BuildingProperties, 'name'> {
  const height = parseHeight(tags.height)
  if (height !== null) return { height, estimated: false }

  const levels = parsePositive(tags['building:levels'])
  if (levels !== null) return { height: levels * LEVEL_HEIGHT, estimated: false }

  const area = footprintArea(ring)
  let estimate = HEIGHT_BY_FOOTPRINT.find(([maxArea]) => area < maxArea)?.[1] ?? DEFAULT_HEIGHT
  if (LOW_BUILDING_TYPES.has(tags.building)) estimate = Math.min(estimate, LOW_BUILDING_HEIGHT)
  return { height: estimate, estimated: true }
}

/** Footprint area in square metres (shoelace formula on a local flat projection). */
function footprintArea(ring: Position[]): number {
  const metresPerDegreeLng = METRES_PER_DEGREE_LNG_AT_EQUATOR * Math.cos((ring[0][1] * Math.PI) / 180)
  let twiceArea = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng0, lat0] = ring[i]
    const [lng1, lat1] = ring[i + 1]
    twiceArea += (lng0 * metresPerDegreeLng) * (lat1 * METRES_PER_DEGREE_LAT) - (lng1 * metresPerDegreeLng) * (lat0 * METRES_PER_DEGREE_LAT)
  }
  return Math.abs(twiceArea) / 2
}

/** Parses values like "12", "12.5 m" or "40 ft" into metres. */
function parseHeight(value: string | undefined): number | null {
  const number = parsePositive(value)
  if (number === null || value === undefined) return null
  return /ft|'/.test(value) ? number * 0.3048 : number
}

function parsePositive(value: string | undefined): number | null {
  if (value === undefined) return null
  const number = parseFloat(value.replace(',', '.'))
  return Number.isFinite(number) && number > 0 ? number : null
}
