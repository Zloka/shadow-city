import { Badge, Box, CloseButton, HStack, Stack, Text } from '@chakra-ui/react'
import type { Feature, Point } from 'geojson'
import { CloudSun, Moon, Sun } from 'lucide-react'
import { formatDuration, formatTime } from './format'
import type { PoiProperties } from './osm'
import { Panel } from './Panel'
import { PlaceDetails } from './PlaceDetails'
import { PlaceIcon } from './PlaceIcon'
import { groupOf, kindLabel } from './places'
import {
  type SunIndex,
  type SunState,
  type TimelineSegment,
  getCachedDayTimeline,
  nextSunAfter,
  segmentAt,
  sunMinutes,
} from './sunlight'

export type Place = Feature<Point, PoiProperties & { sun: SunState }>

const SEGMENT_COLORS: Record<SunState, string> = {
  sun: '#f6c343',
  shade: '#b4bfcf',
  night: '#1e2747',
}

const STATUS_STYLES: Record<SunState, { icon: typeof Sun; palette: string }> = {
  sun: { icon: Sun, palette: 'yellow' },
  shade: { icon: CloudSun, palette: 'gray' },
  night: { icon: Moon, palette: 'blue' },
}

const HOUR_TICKS = [0, 6, 12, 18, 24]

type PlacePanelProps = {
  place: Place
  index: SunIndex
  date: Date
  onDateChange: (date: Date) => void
  onClose: () => void
}

export function PlacePanel({ place, index, date, onDateChange, onClose }: PlacePanelProps) {
  const { name, kind, sun } = place.properties
  const coordinates = place.geometry.coordinates
  const timeline = getCachedDayTimeline(index, coordinates, date)
  const total = sunMinutes(timeline)
  const status = describeNow(sun, timeline, date)
  const { icon: StatusIcon, palette } = STATUS_STYLES[sun]
  const color = groupOf(kind)?.color

  function jumpTo(fraction: number) {
    const next = new Date(date)
    next.setHours(0, Math.round((fraction * 24 * 60) / 5) * 5, 0, 0)
    onDateChange(next)
  }

  const minutesNow = date.getHours() * 60 + date.getMinutes()

  return (
    <Panel
      top="20"
      right="3"
      left={{ base: '3', md: 'auto' }}
      width={{ md: 'sm' }}
      maxHeight="calc(100dvh - 7rem)"
      overflowY="auto"
      p="4"
    >
      <Stack gap="4">
        <HStack align="start" gap="3">
          <Box
            display="flex"
            alignItems="center"
            justifyContent="center"
            boxSize="9"
            borderRadius="xl"
            flexShrink={0}
            color="white"
            bg={color}
          >
            <PlaceIcon kind={kind} size={18} />
          </Box>
          <Stack gap="0" flex="1" minWidth="0">
            <Text fontWeight="700" truncate>
              {name ?? kindLabel(kind)}
            </Text>
            <Text textStyle="xs" color="fg.muted">
              {name ? kindLabel(kind) : 'Unnamed place'}
            </Text>
          </Stack>
          <CloseButton size="xs" borderRadius="full" onClick={onClose} aria-label="Close" />
        </HStack>

        <Stack gap="1">
          <Badge
            alignSelf="start"
            size="lg"
            borderRadius="full"
            colorPalette={palette}
            variant={sun === 'sun' ? 'solid' : 'subtle'}
          >
            <StatusIcon size={14} />
            {status.headline}
          </Badge>
          {status.detail && (
            <Text textStyle="xs" color="fg.muted">
              {status.detail}
            </Text>
          )}
        </Stack>

        <Stack gap="1">
          <Box
            position="relative"
            height="3"
            borderRadius="full"
            overflow="hidden"
            cursor="pointer"
            display="flex"
            title="Click to jump to that time"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              jumpTo((event.clientX - rect.left) / rect.width)
            }}
          >
            {timeline.map((segment) => (
              <Box
                key={segment.start.getTime()}
                flexGrow={segment.end.getTime() - segment.start.getTime()}
                bg={SEGMENT_COLORS[segment.state]}
              />
            ))}
            <Box
              position="absolute"
              top="0"
              bottom="0"
              width="3px"
              borderRadius="full"
              bg="orange.600"
              left={`${(minutesNow / (24 * 60)) * 100}%`}
            />
          </Box>
          <HStack justify="space-between" textStyle="2xs" color="fg.muted" fontVariantNumeric="tabular-nums">
            {HOUR_TICKS.map((hour) => (
              <Text key={hour}>{String(hour).padStart(2, '0')}</Text>
            ))}
          </HStack>
        </Stack>

        <Text textStyle="xs" color="fg.muted">
          {total > 0
            ? `${formatDuration(total)} of direct sun on this day · click the bar to jump to a time`
            : 'No direct sun on this day'}
        </Text>

        <PlaceDetails details={place.properties} date={date} />
      </Stack>
    </Panel>
  )
}

function describeNow(
  sun: SunState,
  timeline: TimelineSegment[],
  date: Date,
): { headline: string; detail: string | null } {
  const next = nextSunAfter(timeline, date)
  const nextText = next ? `Sun again ${formatTime(next.start)}–${formatTime(next.end)}` : null
  if (sun === 'sun') {
    const segment = segmentAt(timeline, date)
    return {
      headline: segment?.state === 'sun' ? `Sunny until ${formatTime(segment.end)}` : 'Sunny now',
      detail: null,
    }
  }
  if (sun === 'shade') return { headline: 'In the shade', detail: nextText ?? 'No more sun today' }
  return { headline: 'Sun is down', detail: nextText }
}
