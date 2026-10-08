import { Box, Button, HStack, IconButton, Input, InputGroup, Spacer, Spinner, Text } from '@chakra-ui/react'
import type { FeatureCollection } from 'geojson'
import {
  type GeoJSONSource,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  type StyleSpecification,
  setWorkerUrl,
} from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { CircleQuestionMark, MapPin, RefreshCw, Search, Share2, Sun, ZoomIn } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MIN_DETAIL_ZOOM, areaAround, containsArea } from './area'
import { formatDistance, formatTime } from './format'
import { distanceInMetres } from './geo'
import { searchPlace } from './geocode'
import { type Bbox, type OsmData, fetchArea, personFeature, shadowCasters } from './osm'
import { LoadingOverlay } from './LoadingOverlay'
import { Logo } from './Logo'
import { Panel } from './Panel'
import { type Place, PlacePanel } from './PlacePanel'
import { kindLabel, placeColorExpression } from './places'
import { MIN_SHADOW_ALTITUDE, computeShadows } from './shadows'
import { buildShareHash, readShareLink } from './shareLink'
import { SunnyList } from './SunnyList'
import { createSunIndex, getSunState } from './sunlight'
import { SunPanel } from './SunPanel'
import { useThrottled } from './useThrottled'
import { Welcome } from './Welcome'
import {
  MAX_PITCH,
  type ViewMode,
  getGlowOpacity,
  getNightOpacity,
  getMoon,
  getMoonShadowOpacity,
  getShadowOpacity,
  getSky,
  getSun,
  getSunLight,
  getSunViewCamera,
} from './sun'
import { Toaster, toaster } from './toaster'

// MapLibre derives its worker URL from its own module location, which Vite's
// dependency pre-bundling and production build both move. Point it at the file explicitly.
setWorkerUrl(maplibreWorkerUrl)

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
const HELSINKI: [number, number] = [24.9384, 60.1699]
const FLIGHT_MS = 3000
// Shadows follow every time step; checking each place for sun is heavier (about 30 ms for
// central Helsinki), so places and the sunny list follow the time at most this often.
const PLACE_UPDATE_MS = 250
// Rebuilding the shadows and handing them to the map costs tens of milliseconds in dense
// areas (about 45 ms for the 4,500 casters of central Helsinki), so the more casters, the
// less often shadows follow the time. Lighting and sky still follow every step.
function shadowUpdateMs(casterCount: number): number {
  if (casterCount > 3000) return 200
  if (casterCount > 1500) return 100
  return 50
}
// The sun marker sits this many metres away in the sun's direction, while the sun is low.
const SUN_MARKER_DISTANCE = 3000
const SUN_MARKER_MAX_ALTITUDE = 15
// Degrees of bearing or pitch the sun's-eye camera must be off before it moves.
const CAMERA_FOLLOW_THRESHOLD = 0.05
// The opening sweep from sunrise to the current time, with a slow turn of the camera.
const INTRO_MS = 3500
const INTRO_TURN_DEGREES = -35
const INTRO_UPDATE_MS = 50
// When the intro runs at night it ends this long before sunset instead.
const INTRO_NIGHT_FALLBACK_MS = 2 * 60 * 60_000
const WELCOME_SEEN_KEY = 'shadow-city:welcome-seen'
// Load once the position and zoom have stayed put this long; rotating and tilting don't count.
const AUTO_LOAD_DELAY_MS = 1200
// Load a margin around the view so small pans and zooms don't need a new request.
const LOAD_MARGIN = 1.5
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
const WORLD: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-180, -85],
            [180, -85],
            [180, 85],
            [-180, 85],
            [-180, -85],
          ],
        ],
      },
    },
  ],
}

// Positron's road shield filters compare `ref_length` with no default, so every road
// without a route number logs a warning. Treat a missing value as too long to show.
function withDefaultRefLength(style: StyleSpecification): StyleSpecification {
  return JSON.parse(
    JSON.stringify(style).replaceAll(
      '["get","ref_length"]',
      '["coalesce",["get","ref_length"],99]',
    ),
  ) as StyleSpecification
}

function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<OsmData | null>(null)
  // A shared link opens the same view, time and place.
  const [shared] = useState(() => readShareLink(window.location.hash))
  const [date, setDate] = useState(() => shared.date ?? new Date())
  const [center, setCenter] = useState<[number, number]>(shared.view?.center ?? HELSINKI)
  const [zoom, setZoom] = useState(shared.view?.zoom ?? 15)
  const [selectedKey, setSelectedKey] = useState<string | null>(shared.placeKey)
  const [viewMode, setViewMode] = useState<ViewMode>('free')
  const previousViewMode = useRef<ViewMode>('free')
  const [listOpen, setListOpen] = useState(() => window.matchMedia('(min-width: 48em)').matches)
  // First visit only, and not when opening someone's shared link.
  const [welcomeOpen, setWelcomeOpen] = useState(() => !shared.view && !hasSeenWelcome())
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [locating, setLocating] = useState(false)
  const [userPosition, setUserPosition] = useState<[number, number] | null>(null)
  const autoLoaded = useRef(false)
  // The area of the latest request (in flight or done) and of the latest successful one.
  const requestedArea = useRef<Bbox | null>(null)
  const loadedArea = useRef<Bbox | null>(null)
  const loadController = useRef<AbortController | null>(null)
  const userMarker = useRef<Marker | null>(null)
  const sunMarker = useRef<Marker | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  // A shared link sets its own time, so it skips the intro.
  const introDone = useRef(Boolean(shared.date))
  const introFrame = useRef<number | null>(null)

  // The sun is computed for the centre rounded to about 100 m: its direction changes by about
  // 0.001° over that distance, and tiny centre changes must not produce a new sun, because in
  // the sun's-eye views the camera follows the sun and moving the camera reports a new centre.
  const sunLng = Math.round(center[0] * 1000) / 1000
  const sunLat = Math.round(center[1] * 1000) / 1000
  const sun = useMemo(() => getSun(date, sunLat, sunLng), [date, sunLat, sunLng])
  const person = useMemo(() => (userPosition ? personFeature(userPosition) : null), [userPosition])
  const casters = useMemo(
    () => [...(data ? shadowCasters(data) : []), ...(person ? [person] : [])],
    [data, person],
  )
  const shadowDate = useThrottled(date, shadowUpdateMs(casters.length))
  // Shadows follow the sun, and after sunset the moon: faint moonlight shadows.
  const shadowLight = useMemo(() => {
    const sunNow = getSun(shadowDate, sunLat, sunLng)
    return sunNow.altitude > 0 ? sunNow : getMoon(shadowDate, sunLat, sunLng)
  }, [shadowDate, sunLat, sunLng])
  const shadows = useMemo(() => computeShadows(casters, shadowLight), [casters, shadowLight])
  const sunIndex = useMemo(() => (data ? createSunIndex(casters) : null), [data, casters])
  const placeDate = useThrottled(date, PLACE_UPDATE_MS)
  const placeSun = useMemo(() => getSun(placeDate, sunLat, sunLng), [placeDate, sunLat, sunLng])
  const sunStates = useMemo(() => {
    if (!data || !sunIndex) return []
    return data.pois.features.map((feature) =>
      getSunState(sunIndex, feature.geometry.coordinates, placeSun.altitude, placeSun.azimuth),
    )
  }, [data, sunIndex, placeSun])
  // Rebuilding the places re-sends them to the map and re-sorts the list, so only do it when
  // at least one place has moved between sun and shade.
  const sunStatesKey = sunStates.join()
  const places = useMemo<Place[]>(
    () =>
      (data?.pois.features ?? []).map((feature, i) => ({
        ...feature,
        properties: { ...feature.properties, sun: sunStates[i] ?? 'night' },
      })),
    // sunStatesKey stands in for sunStates, so an unchanged result keeps the same array.
    [data, sunStatesKey],
  )
  const selectedPlace = places.find((place) => place.properties.key === selectedKey)

  useEffect(() => {
    const map = new MapLibreMap({
      container: containerRef.current!,
      center: shared.view?.center ?? HELSINKI,
      zoom: shared.view?.zoom ?? 15,
      bearing: shared.view?.bearing ?? 0,
      pitch: shared.view?.pitch ?? 45,
      maxPitch: MAX_PITCH,
    })
    map.setStyle(STYLE_URL, { transformStyle: (_previous, next) => withDefaultRefLength(next) })
    map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-right')

    map.on('load', () => {
      // Keep street and place labels readable above the extruded buildings.
      const firstSymbolId = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id

      // Shadows are rebuilt on every time change; preparing tiles only up to zoom 16
      // (instead of 18) makes each rebuild much cheaper without visible difference.
      map.addSource('shadows', { type: 'geojson', data: EMPTY, maxzoom: 16 })
      map.addSource('buildings', { type: 'geojson', data: EMPTY })
      map.addSource('pois', { type: 'geojson', data: EMPTY })
      map.addSource('world', { type: 'geojson', data: WORLD })

      map.addLayer(
        {
          id: 'golden-glow',
          type: 'fill',
          source: 'world',
          paint: { 'fill-color': '#ffb347', 'fill-opacity': 0 },
        },
        firstSymbolId,
      )
      map.addLayer(
        {
          id: 'shadows',
          minzoom: MIN_DETAIL_ZOOM,
          // A flat extrusion rather than a fill: extrusion opacity applies to the layer as a
          // whole, so overlapping shadows don't darken each other and the ground shows through.
          type: 'fill-extrusion',
          source: 'shadows',
          paint: {
            'fill-extrusion-color': '#4a5a7c',
            'fill-extrusion-height': 0,
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0,
          },
        },
        firstSymbolId,
      )
      map.addLayer(
        {
          id: 'buildings-3d',
          minzoom: MIN_DETAIL_ZOOM,
          type: 'fill-extrusion',
          source: 'buildings',
          paint: {
            // Trees share the layer with buildings so they hide behind each other correctly.
            'fill-extrusion-color': [
              'match',
              ['get', 'part'],
              'crown',
              '#8fbd6b',
              'trunk',
              '#8a6a4b',
              'person',
              '#3182ce',
              ['case', ['get', 'estimated'], '#dde2ea', '#bcc5d3'],
            ],
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': ['coalesce', ['get', 'base'], 0],
            'fill-extrusion-opacity': 0.9,
          },
        },
        firstSymbolId,
      )
      // Darkens everything below the labels after sunset, so labels and places stay bright.
      map.addLayer(
        {
          id: 'night-tint',
          type: 'fill',
          source: 'world',
          paint: { 'fill-color': '#0b1a3a', 'fill-opacity': 0 },
        },
        firstSymbolId,
      )
      // Places in the sun are larger with a golden ring; shaded ones fade back.
      map.addLayer({
        id: 'pois',
        minzoom: MIN_DETAIL_ZOOM,
        type: 'circle',
        source: 'pois',
        paint: {
          'circle-radius': ['match', ['get', 'sun'], 'sun', 6.5, 4.5],
          'circle-color': placeColorExpression(),
          'circle-opacity': ['match', ['get', 'sun'], 'shade', 0.6, 1],
          'circle-stroke-color': ['match', ['get', 'sun'], 'sun', '#facc15', '#ffffff'],
          'circle-stroke-width': ['match', ['get', 'sun'], 'sun', 2.5, 1.5],
        },
      })
      map.addLayer({
        id: 'pois-selected',
        minzoom: MIN_DETAIL_ZOOM,
        type: 'circle',
        source: 'pois',
        filter: ['==', ['get', 'key'], ''],
        paint: {
          'circle-radius': 11,
          'circle-opacity': 0,
          'circle-stroke-color': '#1a202c',
          'circle-stroke-width': 2.5,
        },
      })

      setMapReady(true)
    })
    map.on('click', (event) => {
      // A little slack around the tap point makes the small dots easy to hit on touch screens.
      const { x, y } = event.point
      const [place] = map.queryRenderedFeatures(
        [
          [x - 6, y - 6],
          [x + 6, y + 6],
        ],
        { layers: ['pois'] },
      )
      setSelectedKey((place?.properties.key as string | undefined) ?? null)
    })
    map.on('mouseenter', 'pois', () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', 'pois', () => (map.getCanvas().style.cursor = ''))
    map.on('moveend', () => {
      const { lng, lat } = map.getCenter()
      // Keep the same array when only the angle changed: the sun follows the centre, and the
      // sun's-eye camera follows the sun, so a new array would loop forever.
      setCenter((previous) => (previous[0] === lng && previous[1] === lat ? previous : [lng, lat]))
      setZoom(map.getZoom())
    })
    // Turning or tilting the map by hand leaves the sun's-eye view.
    const leaveSunView = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) setViewMode('free')
    }
    map.on('rotatestart', leaveSunView)
    map.on('pitchstart', leaveSunView)

    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
    // Runs once: a shared view only sets where the map starts.
  }, [])

  // Pasting another link into the address bar only changes the hash; reload to open it.
  // Our own updates use replaceState, which doesn't fire hashchange.
  useEffect(() => {
    const reload = () => window.location.reload()
    window.addEventListener('hashchange', reload)
    return () => window.removeEventListener('hashchange', reload)
  }, [])

  const currentShareHash = useCallback(() => {
    const map = mapRef.current
    if (!map) return null
    const { lng, lat } = map.getCenter()
    return buildShareHash(
      { center: [lng, lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() },
      date,
      selectedKey,
    )
  }, [date, selectedKey])

  // Keep the address bar in sync, debounced so dragging the slider doesn't flood the history API.
  useEffect(() => {
    if (!mapReady) return
    const timer = setTimeout(() => {
      const hash = currentShareHash()
      if (hash) window.history.replaceState(null, '', hash)
    }, 300)
    return () => clearTimeout(timer)
  }, [mapReady, center, currentShareHash])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !data) return
    map.getSource<GeoJSONSource>('buildings')?.setData({
      type: 'FeatureCollection',
      features: [...data.buildings.features, ...data.trees.features, ...(person ? [person] : [])],
    })
  }, [mapReady, data, person])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    map.getSource<GeoJSONSource>('pois')?.setData({ type: 'FeatureCollection', features: places })
  }, [mapReady, places])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    map.setFilter('pois-selected', ['==', ['get', 'key'], selectedKey ?? ''])
  }, [mapReady, selectedKey])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    map.getSource<GeoJSONSource>('shadows')?.setData(shadows)
  }, [mapReady, shadows])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    map.setLight(getSunLight(sun))
    map.setSky(getSky(sun.altitude))
    const shadowOpacity =
      sun.altitude > 0 ? getShadowOpacity(sun.altitude) : getMoonShadowOpacity(getMoon(date, sunLat, sunLng))
    map.setPaintProperty('shadows', 'fill-extrusion-opacity', shadowOpacity)
    map.setPaintProperty('golden-glow', 'fill-opacity', getGlowOpacity(sun.altitude))
    map.setPaintProperty('night-tint', 'fill-opacity', getNightOpacity(sun.altitude))
  }, [mapReady, sun, date, sunLat, sunLng])

  // A glowing sun far away in its direction. Only while the sun is low: a marker on the ground
  // can only pass for the sun when the sun is near the horizon, as in golden hour.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (sun.altitude <= 0 || sun.altitude > SUN_MARKER_MAX_ALTITUDE) {
      sunMarker.current?.remove()
      return
    }
    if (!sunMarker.current) {
      const element = document.createElement('div')
      element.style.cssText =
        'width:72px;height:72px;border-radius:50%;pointer-events:none;' +
        'background:radial-gradient(circle,#fffbe6 0%,#ffd166 28%,rgba(255,177,71,0.45) 48%,rgba(255,177,71,0) 70%)'
      sunMarker.current = new Marker({ element, pitchAlignment: 'viewport', rotationAlignment: 'viewport' })
    }
    const azimuth = (sun.azimuth * Math.PI) / 180
    const lat = sunLat + (Math.cos(azimuth) * SUN_MARKER_DISTANCE) / 110_574
    const lng = sunLng + (Math.sin(azimuth) * SUN_MARKER_DISTANCE) / (111_320 * Math.cos((sunLat * Math.PI) / 180))
    sunMarker.current.setLngLat([lng, lat]).addTo(map)
  }, [mapReady, sun, sunLat, sunLng])

  // In the sun's-eye views the camera follows the sun as the time changes.
  useEffect(() => {
    const map = mapRef.current
    const switched = previousViewMode.current !== viewMode
    previousViewMode.current = viewMode
    if (!map || !mapReady || viewMode === 'free') return
    const camera = getSunViewCamera(sun, viewMode)
    if (switched) {
      map.easeTo({ ...camera, duration: 1500 })
      return
    }
    // Only move when the angle visibly changes; every jump redraws the whole map.
    const bearingChange = Math.abs(((map.getBearing() - camera.bearing + 540) % 360) - 180)
    const pitchChange = Math.abs(map.getPitch() - camera.pitch)
    if (!map.isMoving() && (bearingChange > CAMERA_FOLLOW_THRESHOLD || pitchChange > CAMERA_FOLLOW_THRESHOLD)) {
      map.jumpTo(camera)
    }
  }, [mapReady, viewMode, sun])

  /** Loads the area around the view, replacing the previous one and cancelling any load in flight. */
  const loadArea = useCallback(async (): Promise<OsmData | null> => {
    const map = mapRef.current
    if (!map || map.getZoom() < MIN_DETAIL_ZOOM) return null
    const area = areaAround(map, LOAD_MARGIN)
    loadController.current?.abort()
    const controller = new AbortController()
    loadController.current = controller
    requestedArea.current = area
    setLoading(true)
    try {
      const result = await fetchArea(area, controller.signal)
      loadedArea.current = area
      setData(result)
      return result
    } catch (error) {
      // Superseded by a newer load.
      if (controller.signal.aborted) return null
      requestedArea.current = loadedArea.current
      toaster.create({
        type: 'error',
        title: 'Map data is temporarily unavailable',
        description: `The public OpenStreetMap servers are busy. Try again in a moment with the reload button. (${
          error instanceof Error ? error.message : String(error)
        })`,
        closable: true,
      })
      return null
    } finally {
      if (loadController.current === controller) {
        loadController.current = null
        setLoading(false)
      }
    }
  }, [])

  // Load whenever the view comes to rest outside the area already loaded or loading. The key
  // only changes with position and zoom, so rotating or tilting doesn't restart the wait.
  const viewKey = `${center[0].toFixed(5)},${center[1].toFixed(5)},${zoom.toFixed(2)}`
  useEffect(() => {
    if (!mapReady) return
    const timer = setTimeout(() => {
      const map = mapRef.current
      if (!map || map.getZoom() < MIN_DETAIL_ZOOM) return
      const requested = requestedArea.current
      if (requested && containsArea(requested, areaAround(map, 1))) return
      loadArea()
    }, AUTO_LOAD_DELAY_MS)
    return () => clearTimeout(timer)
  }, [mapReady, viewKey, loadArea])

  /** Flies to a spot at street level and loads the buildings and places around it. */
  const flyAndLoad = useCallback(
    async (center: [number, number]) => {
      const map = mapRef.current
      if (!map) return null
      // The timeout covers a flight that ends without a moveend event.
      const arrived = new Promise((resolve) => {
        map.once('moveend', resolve)
        setTimeout(resolve, FLIGHT_MS + 1000)
      })
      map.flyTo({ center, zoom: 16, pitch: 45, maxDuration: FLIGHT_MS })
      await arrived
      return loadArea()
    },
    [loadArea],
  )

  // The tallest building with a known height casts the longest shadow at any moment.
  const longestShadow = useMemo(() => {
    if (!data || placeSun.altitude <= 0) return null
    let tallest: (typeof data.buildings.features)[number] | null = null
    for (const building of data.buildings.features) {
      if (building.properties.estimated) continue
      if (!tallest || building.properties.height > tallest.properties.height) tallest = building
    }
    if (!tallest) return null
    const tanAltitude = Math.tan((Math.max(placeSun.altitude, MIN_SHADOW_ALTITUDE) * Math.PI) / 180)
    return {
      name: tallest.properties.name,
      height: tallest.properties.height,
      length: tallest.properties.height / tanAltitude,
      center: tallest.geometry.coordinates[0][0] as [number, number],
    }
  }, [data, placeSun])

  const flyTo = useCallback((center: [number, number]) => {
    mapRef.current?.flyTo({ center, zoom: Math.max(mapRef.current.getZoom(), 16.5) })
  }, [])

  const selectPlace = useCallback((place: Place) => {
    setSelectedKey(place.properties.key)
    const map = mapRef.current
    if (!map) return
    const [lng, lat] = place.geometry.coordinates
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16.5) })
  }, [])

  async function search(event: React.FormEvent) {
    event.preventDefault()
    const map = mapRef.current
    if (!map || !query.trim()) return
    setSearching(true)
    try {
      const bounds = map.getBounds()
      const result = await searchPlace(query.trim(), [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
      ])
      if (!result) {
        toaster.create({ type: 'info', title: `No match for "${query.trim()}"` })
        return
      }
      setSelectedKey(null)
      await flyAndLoad(result.center)
    } catch (error) {
      toaster.create({
        type: 'error',
        title: 'Search failed',
        description: error instanceof Error ? error.message : String(error),
        closable: true,
      })
    } finally {
      setSearching(false)
    }
  }

  /** Finds the nearest place in direct sun right now, starting from the device's location. */
  async function findSun() {
    const map = mapRef.current
    if (!map) return
    if (!navigator.geolocation) {
      toaster.create({ type: 'error', title: 'This browser cannot share its location' })
      return
    }
    setLocating(true)
    introDone.current = true
    cancelIntro()
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15_000,
        }),
      )
      const here: [number, number] = [position.coords.longitude, position.coords.latitude]
      userMarker.current ??= new Marker({ color: '#3182ce' })
      userMarker.current.setLngLat(here).addTo(map)
      setUserPosition(here)

      const now = new Date()
      setDate(now)
      const result = await flyAndLoad(here)
      if (!result) return

      const sunNow = getSun(now, here[1], here[0])
      if (sunNow.altitude <= 0) {
        toaster.create({
          type: 'info',
          title: 'The sun is down',
          description: sunNow.sunrise ? `Sunrise at ${formatTime(sunNow.sunrise)}.` : undefined,
        })
        return
      }

      const index = createSunIndex(shadowCasters(result))
      let nearest: { place: Place; distance: number } | null = null
      for (const feature of result.pois.features) {
        const coordinates = feature.geometry.coordinates
        if (getSunState(index, coordinates, sunNow.altitude, sunNow.azimuth) !== 'sun') continue
        const distance = distanceInMetres(here, coordinates)
        if (!nearest || distance < nearest.distance) {
          nearest = { place: { ...feature, properties: { ...feature.properties, sun: 'sun' } }, distance }
        }
      }
      if (!nearest) {
        toaster.create({ type: 'info', title: 'No sunny spots nearby right now' })
        return
      }
      selectPlace(nearest.place)
      const { name, kind } = nearest.place.properties
      toaster.create({
        type: 'success',
        title: `Nearest sun: ${name ?? kindLabel(kind)}`,
        description: `${formatDistance(nearest.distance)} away`,
      })
    } catch (error) {
      const message =
        error instanceof GeolocationPositionError
          ? error.code === error.PERMISSION_DENIED
            ? 'Location permission was denied.'
            : 'Your location could not be determined.'
          : error instanceof Error
            ? error.message
            : String(error)
      toaster.create({ type: 'error', title: 'Could not find your location', description: message })
    } finally {
      setLocating(false)
    }
  }

  async function share() {
    const hash = currentShareHash()
    if (!hash) return
    window.history.replaceState(null, '', hash)
    try {
      await navigator.clipboard.writeText(window.location.href)
      toaster.create({ type: 'success', title: 'Link copied', description: 'It opens this view, time and place.' })
    } catch {
      toaster.create({ type: 'info', title: 'Copy this link', description: window.location.href, closable: true })
    }
  }

  const cancelIntro = useCallback(() => {
    if (introFrame.current !== null) cancelAnimationFrame(introFrame.current)
    introFrame.current = null
  }, [])

  /** Any time change from the user stops the intro, so it never fights the slider. */
  const changeDate = useCallback(
    (next: Date) => {
      cancelIntro()
      setDate(next)
    },
    [cancelIntro],
  )

  /** Sweeps the time from sunrise to now while the camera turns: shadows swing across the city. */
  const playIntro = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const now = new Date()
    const { lng, lat } = map.getCenter()
    const today = getSun(now, lat, lng)
    if (!today.sunrise || !today.sunset) return

    const from = today.sunrise.getTime()
    let to = now.getTime()
    if (today.altitude <= 0) {
      to = today.sunset.getTime() - INTRO_NIGHT_FALLBACK_MS
      toaster.create({
        type: 'info',
        title: "It's dark here right now",
        description: 'Showing this afternoon instead. Press Now for the current time.',
      })
    }
    if (to <= from) return

    const ease = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)
    map.easeTo({ bearing: map.getBearing() + INTRO_TURN_DEGREES, duration: INTRO_MS, easing: ease })
    const start = performance.now()
    let lastUpdate = 0
    const tick = (time: number) => {
      const progress = Math.min(1, (time - start) / INTRO_MS)
      if (progress === 1 || time - lastUpdate >= INTRO_UPDATE_MS) {
        lastUpdate = time
        setDate(new Date(from + (to - from) * ease(progress)))
      }
      introFrame.current = progress < 1 ? requestAnimationFrame(tick) : null
    }
    introFrame.current = requestAnimationFrame(tick)
  }, [])

  // Play the intro once the first area is on screen and the welcome card is out of the way.
  useEffect(() => {
    if (!data || welcomeOpen || introDone.current) return
    introDone.current = true
    playIntro()
  }, [data, welcomeOpen, playIntro])

  useEffect(() => cancelIntro, [cancelIntro])

  function closeWelcome() {
    setWelcomeOpen(false)
    markWelcomeSeen()
  }

  // Load the starting view right away so the first thing people see is the city in 3D.
  useEffect(() => {
    if (!mapReady || autoLoaded.current) return
    autoLoaded.current = true
    loadArea()
  }, [mapReady, loadArea])

  return (
    <Box position="fixed" inset="0" overflow="hidden">
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      <Panel top="3" left="3" right="3" px="3" py="2">
        <HStack gap="2">
          <HStack gap="2" flexShrink={0} pe="1">
            <Logo />
            <Box display={{ base: 'none', md: 'block' }} lineHeight="1.15">
              <Text fontWeight="800" letterSpacing="-0.02em">
                Shadow City
              </Text>
              <Text textStyle="2xs" color="fg.muted">
                The city in a new light
              </Text>
            </Box>
          </HStack>
          <form onSubmit={search} style={{ flex: 1, maxWidth: '22rem', minWidth: 0 }}>
            <InputGroup startElement={searching ? <Spinner size="xs" /> : <Search size={16} />}>
              <Input
                ref={searchInput}
                size="sm"
                borderRadius="full"
                bg="white"
                placeholder="Search a street, district or city"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search for a place"
              />
            </InputGroup>
          </form>
          <Spacer />
          <IconButton
            size="sm"
            variant="ghost"
            borderRadius="full"
            onClick={() => loadArea()}
            disabled={loading || !mapReady || zoom < MIN_DETAIL_ZOOM}
            aria-label="Reload this area"
            title={loading ? 'Loading…' : 'Areas load automatically when the map comes to rest. Click to reload.'}
          >
            {loading ? <Spinner size="sm" /> : <RefreshCw />}
          </IconButton>
          <IconButton
            size="sm"
            variant={listOpen ? 'subtle' : 'ghost'}
            colorPalette={listOpen ? 'orange' : 'gray'}
            borderRadius="full"
            onClick={() => setListOpen(!listOpen)}
            aria-label="Sunny spots"
            title="Sunny spots"
          >
            <Sun />
          </IconButton>
          <IconButton
            size="sm"
            variant="ghost"
            borderRadius="full"
            onClick={share}
            disabled={!mapReady}
            aria-label="Share this view"
            title="Copy a link to this view, time and place"
          >
            <Share2 />
          </IconButton>
          <IconButton
            size="sm"
            variant="ghost"
            borderRadius="full"
            onClick={() => setWelcomeOpen(true)}
            aria-label="How it works"
            title="How it works"
          >
            <CircleQuestionMark />
          </IconButton>
          <Button
            size="sm"
            colorPalette="yellow"
            borderRadius="full"
            onClick={findSun}
            disabled={locating || !mapReady}
          >
            {locating ? <Spinner size="sm" /> : <MapPin />}
            <Box as="span" display={{ base: 'none', sm: 'inline' }}>
              Find me sun
            </Box>
          </Button>
        </HStack>
      </Panel>

      {mapReady && zoom < MIN_DETAIL_ZOOM && (
        <Panel top="20" left="50%" transform="translateX(-50%)" px="4" py="2" pointerEvents="none">
          <HStack gap="2" textStyle="sm" fontWeight="600">
            <ZoomIn size={16} /> Zoom in to see buildings, shadows and places
          </HStack>
        </Panel>
      )}
      {loading && !data && <LoadingOverlay />}

      {listOpen && (
        <SunnyList
          places={places}
          index={sunIndex}
          date={placeDate}
          center={center}
          sunrise={sun.sunrise}
          longestShadow={longestShadow}
          onFlyTo={flyTo}
          onSelect={selectPlace}
          onClose={() => setListOpen(false)}
        />
      )}
      {selectedPlace && sunIndex && (
        <PlacePanel
          place={selectedPlace}
          index={sunIndex}
          date={placeDate}
          onDateChange={changeDate}
          onClose={() => setSelectedKey(null)}
        />
      )}
      <SunPanel
        date={date}
        sun={sun}
        onDateChange={changeDate}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />
      <Welcome
        open={welcomeOpen}
        onFindSun={() => {
          closeWelcome()
          findSun()
        }}
        onExplore={closeWelcome}
        onSearch={() => {
          closeWelcome()
          // Wait for the dialog to finish closing, which returns focus to the page.
          setTimeout(() => searchInput.current?.focus(), 300)
        }}
      />
      <Toaster />
    </Box>
  )
}

export default App

function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(WELCOME_SEEN_KEY) !== null
  } catch {
    return false
  }
}

function markWelcomeSeen() {
  try {
    localStorage.setItem(WELCOME_SEEN_KEY, '1')
  } catch {
    // Without storage the welcome simply shows again next time.
  }
}
