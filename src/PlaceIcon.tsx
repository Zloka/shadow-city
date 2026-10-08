import {
  Armchair,
  Beer,
  Binoculars,
  Coffee,
  FerrisWheel,
  type LucideIcon,
  MapPin,
  TreePine,
  Umbrella,
  Utensils,
  WavesHorizontal,
} from 'lucide-react'

const KIND_ICONS: Record<string, LucideIcon> = {
  cafe: Coffee,
  restaurant: Utensils,
  bar: Beer,
  biergarten: Beer,
  bench: Armchair,
  picnic_table: TreePine,
  outdoor_seating: Umbrella,
  playground: FerrisWheel,
  beach: WavesHorizontal,
  viewpoint: Binoculars,
}

export function PlaceIcon({ kind, size = 16 }: { kind: string; size?: number }) {
  const Icon = KIND_ICONS[kind] ?? MapPin
  return <Icon size={size} strokeWidth={2.2} />
}
