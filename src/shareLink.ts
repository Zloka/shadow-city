/**
 * The view, time and selected place, stored in the URL hash so a link reopens the same scene:
 * #map=zoom/lat/lng/bearing/pitch&time=2026-10-08T14:35&place=node/123
 */
export type ShareState = {
  view: { center: [number, number]; zoom: number; bearing: number; pitch: number } | null
  /** Local time, so the link shows the same clock time wherever it is opened. */
  date: Date | null
  placeKey: string | null
}

export function readShareLink(hash: string): ShareState {
  const params = new URLSearchParams(hash.replace(/^#/, ''))

  const parts = (params.get('map') ?? '').split('/').map(Number)
  const [zoom, lat, lng, bearing = 0, pitch = 45] = parts
  const view =
    parts.length >= 3 && [zoom, lat, lng, bearing, pitch].every(Number.isFinite)
      ? { center: [lng, lat] as [number, number], zoom, bearing, pitch }
      : null

  const time = params.get('time')?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  const date = time
    ? new Date(Number(time[1]), Number(time[2]) - 1, Number(time[3]), Number(time[4]), Number(time[5]))
    : null

  return { view, date, placeKey: params.get('place') }
}

export function buildShareHash(
  view: NonNullable<ShareState['view']>,
  date: Date,
  placeKey: string | null,
): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const { center, zoom, bearing, pitch } = view
  const parts = [
    `map=${zoom.toFixed(2)}/${center[1].toFixed(5)}/${center[0].toFixed(5)}/${Math.round(bearing)}/${Math.round(pitch)}`,
    `time=${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ]
  if (placeKey) parts.push(`place=${placeKey}`)
  return `#${parts.join('&')}`
}
