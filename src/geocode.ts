const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'

export type SearchResult = {
  name: string
  center: [number, number]
}

/**
 * Looks up a place with OpenStreetMap's Nominatim. Results inside `viewbox` (west, south,
 * east, north) are preferred, so "Kallio" finds the district in the city on screen.
 * Nominatim's usage policy allows about one request per second, so only search on submit.
 */
export async function searchPlace(
  query: string,
  viewbox: [number, number, number, number],
): Promise<SearchResult | null> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
    viewbox: viewbox.join(','),
  })
  const response = await fetch(`${NOMINATIM_URL}?${params}`)
  if (!response.ok) {
    throw new Error(`Search failed: ${response.status} ${response.statusText}`.trim())
  }
  const [first] = (await response.json()) as { lat: string; lon: string; display_name: string }[]
  return first ? { name: first.display_name, center: [Number(first.lon), Number(first.lat)] } : null
}
