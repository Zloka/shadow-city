import { Badge, Box, HStack, Image, Link, Stack, Text, Wrap } from '@chakra-ui/react'
import { Clock, ExternalLink, Globe, MapPin, Phone, Umbrella, Utensils } from 'lucide-react'
import opening_hours from 'opening_hours'
import { useEffect, useMemo, useState } from 'react'
import { formatTime } from './format'
import type { PlaceDetails as Details } from './osm'
import { type WikipediaSummary, fetchWikipediaSummary } from './wikipedia'

type PlaceDetailsProps = {
  details: Details
  date: Date
}

/** Extra facts from the place's OSM tags and Wikipedia; each part appears only if available. */
export function PlaceDetails({ details, date }: PlaceDetailsProps) {
  const { cuisine, outdoorSeating, openingHours, address, website, phone, wikipedia, wikidata } = details
  // Parsing is the expensive part; the panel re-renders whenever the time moves.
  const parsedHours = useMemo(() => (openingHours ? parseOpeningHours(openingHours) : null), [openingHours])
  const hours = openingHours ? describeOpeningHours(parsedHours, openingHours, date) : null
  const summary = useWikipediaSummary(wikipedia, wikidata)

  const hasFacts = cuisine || outdoorSeating || hours || address || website || phone
  if (!hasFacts && !summary) return null

  return (
    <Stack gap="3" borderTopWidth="1px" borderColor="blackAlpha.100" pt="3">
      {(outdoorSeating || cuisine) && (
        <Wrap gap="1.5">
          {outdoorSeating && (
            <Badge colorPalette="orange" borderRadius="full">
              <Umbrella size={12} /> Terrace
            </Badge>
          )}
          {cuisine && (
            <Badge colorPalette="gray" borderRadius="full">
              <Utensils size={12} /> {formatCuisine(cuisine)}
            </Badge>
          )}
        </Wrap>
      )}

      {(hours || address || website || phone) && (
        <Stack gap="1.5" textStyle="xs">
          {hours && (
            <Fact icon={Clock}>
              {hours.status && (
                <Text as="span" fontWeight="700" color={hours.open ? 'green.600' : 'red.600'}>
                  {hours.status}
                </Text>
              )}
              {hours.status && ' · '}
              <Text as="span" color="fg.muted">
                {hours.detail}
              </Text>
            </Fact>
          )}
          {address && <Fact icon={MapPin}>{address}</Fact>}
          {website && (
            <Fact icon={Globe}>
              {/* OSM websites are often tagged without a protocol, which would make a relative link. */}
              <Link
                href={/^https?:\/\//i.test(website) ? website : `https://${website}`}
                target="_blank"
                rel="noreferrer"
                color="orange.600"
                truncate
              >
                {website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
              </Link>
            </Fact>
          )}
          {phone && (
            <Fact icon={Phone}>
              <Link href={`tel:${phone.replace(/\s/g, '')}`} color="orange.600">
                {phone}
              </Link>
            </Fact>
          )}
        </Stack>
      )}

      {summary && (
        <HStack align="start" gap="3">
          {summary.thumbnail && (
            <Image
              src={summary.thumbnail}
              alt={summary.title}
              boxSize="16"
              objectFit="cover"
              borderRadius="lg"
              flexShrink={0}
            />
          )}
          <Box minWidth="0">
            <Text textStyle="xs" lineClamp={4}>
              {summary.extract}
            </Text>
            <Link href={summary.url} target="_blank" rel="noreferrer" textStyle="xs" color="orange.600">
              Wikipedia <ExternalLink size={11} />
            </Link>
          </Box>
        </HStack>
      )}
    </Stack>
  )
}

function Fact({ icon: Icon, children }: { icon: typeof Clock; children: React.ReactNode }) {
  return (
    <HStack gap="2" align="start">
      <Box color="fg.muted" mt="0.5" flexShrink={0}>
        <Icon size={13} />
      </Box>
      <Box minWidth="0">{children}</Box>
    </HStack>
  )
}

function useWikipediaSummary(wikipedia: string | null, wikidata: string | null): WikipediaSummary | null {
  const [summary, setSummary] = useState<{ key: string; value: WikipediaSummary | null } | null>(null)
  const key = `${wikipedia}|${wikidata}`

  useEffect(() => {
    if (!wikipedia && !wikidata) return
    const controller = new AbortController()
    fetchWikipediaSummary(wikipedia, wikidata, controller.signal)
      .then((value) => setSummary({ key, value }))
      // A missing or unreachable article simply isn't shown.
      .catch(() => {})
    return () => controller.abort()
  }, [key, wikipedia, wikidata])

  // Ignore a summary that belongs to the previously selected place.
  return summary?.key === key ? summary.value : null
}

/**
 * "Open · closes 22:00" for the selected time, using the opening_hours library that
 * understands OSM's syntax. Falls back to the raw value when it can't be parsed.
 */
function describeOpeningHours(
  hours: opening_hours | null,
  value: string,
  date: Date,
): { open: boolean; status: string | null; detail: string } {
  if (!hours) return { open: false, status: null, detail: value }
  try {
    const open = hours.getState(date)
    const next = hours.getNextChange(date)
    const sameDay = next && next.toDateString() === date.toDateString()
    const change = next
      ? `${open ? 'closes' : 'opens'} ${sameDay ? '' : `${next.toLocaleDateString(undefined, { weekday: 'short' })} `}${formatTime(next)}`
      : value
    return { open, status: open ? 'Open' : 'Closed', detail: change }
  } catch {
    return { open: false, status: null, detail: value }
  }
}

function parseOpeningHours(value: string): opening_hours | null {
  try {
    return new opening_hours(value, null)
  } catch {
    return null
  }
}

function formatCuisine(value: string): string {
  return value
    .split(';')
    .map((part) => part.trim().replaceAll('_', ' '))
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(', ')
}
