import { Box, Button, CloseButton, HStack, Stack, Text, Wrap } from '@chakra-ui/react'
import { Sun, Umbrella } from 'lucide-react'
import { useMemo, useState } from 'react'
import { formatDistance, formatTime } from './format'
import { distanceInMetres } from './geo'
import { Panel } from './Panel'
import type { Place } from './PlacePanel'
import { PlaceIcon } from './PlaceIcon'
import { PLACE_GROUPS, groupOf, kindLabel } from './places'
import { type SunIndex, getCachedDayTimeline, segmentAt } from './sunlight'

const MAX_ITEMS = 40
// A day timeline per row costs about 1.5 ms after the date changes, so only the rows near
// the top show how long their sun lasts.
const MAX_UNTIL_ITEMS = 12
// Not a place type but the app's best use case: cafés and restaurants with outdoor seating.
const TERRACES = 'terraces'

function isTerrace({ properties }: Place): boolean {
  return properties.kind === 'outdoor_seating' || (properties.outdoorSeating && groupOf(properties.kind)?.id === 'food')
}

type SunnyListProps = {
  places: Place[]
  index: SunIndex | null
  date: Date
  center: [number, number]
  sunrise: Date | null
  longestShadow: { name: string | null; height: number; length: number; center: [number, number] } | null
  onSelect: (place: Place) => void
  onFlyTo: (center: [number, number]) => void
  onClose: () => void
}

export function SunnyList({
  places,
  index,
  date,
  center,
  sunrise,
  longestShadow,
  onSelect,
  onFlyTo,
  onClose,
}: SunnyListProps) {
  const [groupId, setGroupId] = useState<string | null>(null)

  const sunny = useMemo(() => {
    const group = PLACE_GROUPS.find(({ id }) => id === groupId)
    return places
      .filter((place) => place.properties.sun === 'sun')
      .filter((place) => {
        if (groupId === TERRACES) return isTerrace(place)
        return !group || group.kinds.includes(place.properties.kind)
      })
      .map((place) => ({ place, distance: distanceInMetres(center, place.geometry.coordinates) }))
      .sort((a, b) => a.distance - b.distance)
  }, [places, groupId, center])

  const isNight = places.length > 0 && places.every((place) => place.properties.sun === 'night')

  return (
    <Panel
      top="20"
      left="3"
      right={{ base: '3', md: 'auto' }}
      width={{ md: 'xs' }}
      maxHeight="calc(100dvh - 27rem)"
      display="flex"
      flexDirection="column"
    >
      <Stack gap="2" p="4" pb="2">
        <HStack>
          <Box color="orange.400">
            <Sun size={18} />
          </Box>
          <Text fontWeight="700" flex="1">
            In the sun at {formatTime(date)}
          </Text>
          <CloseButton size="xs" borderRadius="full" onClick={onClose} aria-label="Close" />
        </HStack>
        <Wrap gap="1">
          <Button
            size="2xs"
            borderRadius="full"
            variant={groupId === null ? 'solid' : 'outline'}
            onClick={() => setGroupId(null)}
          >
            All
          </Button>
          <Button
            size="2xs"
            borderRadius="full"
            variant={groupId === TERRACES ? 'solid' : 'outline'}
            onClick={() => setGroupId(TERRACES)}
          >
            <Umbrella size={10} />
            Terraces
          </Button>
          {PLACE_GROUPS.map((group) => (
            <Button
              key={group.id}
              size="2xs"
              borderRadius="full"
              variant={groupId === group.id ? 'solid' : 'outline'}
              onClick={() => setGroupId(group.id)}
            >
              <Box width="2" height="2" borderRadius="full" bg={group.color} />
              {group.label}
            </Button>
          ))}
        </Wrap>
        <Text textStyle="xs" color="fg.muted">
          {isNight
            ? `The sun is down.${sunrise ? ` Sunrise at ${formatTime(sunrise)}.` : ''}`
            : `${sunny.length} of ${places.length} places in direct sun, nearest first`}
        </Text>
        {longestShadow && (
          <Text
            as="button"
            textStyle="xs"
            textAlign="start"
            color="orange.700"
            cursor="pointer"
            _hover={{ textDecoration: 'underline' }}
            onClick={() => onFlyTo(longestShadow.center)}
          >
            Longest shadow: {longestShadow.name ?? `a ${Math.round(longestShadow.height)} m building`},{' '}
            {formatDistance(longestShadow.length)} long →
          </Text>
        )}
      </Stack>

      <Stack gap="0" overflowY="auto" px="2" pb="2">
        {sunny.slice(0, MAX_ITEMS).map(({ place, distance }, i) => (
          <SunnyItem
            key={place.properties.key}
            place={place}
            distance={distance}
            index={i < MAX_UNTIL_ITEMS ? index : null}
            date={date}
            onSelect={onSelect}
          />
        ))}
      </Stack>
    </Panel>
  )
}

type SunnyItemProps = {
  place: Place
  distance: number
  index: SunIndex | null
  date: Date
  onSelect: (place: Place) => void
}

function SunnyItem({ place, distance, index, date, onSelect }: SunnyItemProps) {
  const { name, kind } = place.properties
  const segment = index
    ? segmentAt(getCachedDayTimeline(index, place.geometry.coordinates, date), date)
    : undefined
  const until = segment?.state === 'sun' ? `until ${formatTime(segment.end)}` : ''

  return (
    <HStack
      as="button"
      gap="2"
      px="2"
      py="1.5"
      borderRadius="lg"
      textAlign="start"
      cursor="pointer"
      _hover={{ bg: 'blackAlpha.50' }}
      onClick={() => onSelect(place)}
    >
      <Box
        display="flex"
        alignItems="center"
        justifyContent="center"
        boxSize="6"
        borderRadius="md"
        flexShrink={0}
        color="white"
        bg={groupOf(kind)?.color}
      >
        <PlaceIcon kind={kind} size={13} />
      </Box>
      <Text textStyle="sm" flex="1" truncate>
        {name ?? kindLabel(kind)}
      </Text>
      <Text textStyle="xs" color="fg.muted" whiteSpace="nowrap">
        {[until, formatDistance(distance)].filter(Boolean).join(' · ')}
      </Text>
    </HStack>
  )
}
