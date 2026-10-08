import type { ExpressionSpecification } from 'maplibre-gl'

export type PlaceGroup = {
  id: string
  label: string
  color: string
  kinds: string[]
}

export const PLACE_GROUPS: PlaceGroup[] = [
  { id: 'food', label: 'Cafés & bars', color: '#dd6b20', kinds: ['cafe', 'restaurant', 'bar', 'biergarten'] },
  { id: 'seating', label: 'Benches', color: '#319795', kinds: ['bench', 'picnic_table', 'outdoor_seating'] },
  { id: 'play', label: 'Playgrounds', color: '#805ad5', kinds: ['playground'] },
  { id: 'beach', label: 'Beaches', color: '#d69e2e', kinds: ['beach'] },
  { id: 'view', label: 'Viewpoints', color: '#e53e3e', kinds: ['viewpoint'] },
]

const KIND_LABELS: Record<string, string> = {
  cafe: 'Café',
  restaurant: 'Restaurant',
  bar: 'Bar',
  biergarten: 'Beer garden',
  bench: 'Bench',
  picnic_table: 'Picnic table',
  outdoor_seating: 'Outdoor seating',
  playground: 'Playground',
  beach: 'Beach',
  viewpoint: 'Viewpoint',
}

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind
}

export function groupOf(kind: string): PlaceGroup | undefined {
  return PLACE_GROUPS.find((group) => group.kinds.includes(kind))
}

/** MapLibre expression that colours a place by its group. */
export function placeColorExpression(): ExpressionSpecification {
  const branches = PLACE_GROUPS.flatMap((group) => [group.kinds, group.color])
  // TypeScript can't check a spread against the expression's fixed-arity tuple type.
  return ['match', ['get', 'kind'], ...branches, '#4a5568'] as unknown as ExpressionSpecification
}
