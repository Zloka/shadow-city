import { Badge, Box, Button, Group, HStack, IconButton, Input, Slider, Spacer, Stack, Text } from '@chakra-ui/react'
import { CalendarRange, Eclipse, Move, Moon, Pause, Play, Sun as SunIcon, Sunset } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatDuration, formatTime } from './format'
import { Panel } from './Panel'
import { toaster } from './toaster'
import { type Phase, type Sun, type ViewMode, compassPoint, getPhase } from './sun'

const MINUTES_PER_DAY = 24 * 60

// The time-lapse runs on through the night into the next day. Daylight plays at DAY_SPEED
// (an October day in Helsinki takes about 20 seconds); once twilight ends nothing changes
// on the map, so the night plays at NIGHT_SPEED (about 2.5 seconds).
const DAY_SPEED_MINUTES_PER_SECOND = 35
const NIGHT_SPEED_MINUTES_PER_SECOND = 300
const CIVIL_TWILIGHT = -6
// Updating 20 times a second looks as smooth while moving and spares the map's workers.
const PLAYBACK_UPDATE_MS = 50
// The time-lapse moves in the same 5-minute steps as the slider and only reports a new time
// when it crosses one: by day that is 7 updates a second instead of 20, with no visible loss.
const STEP_MINUTES = 5
const STEP_MS = STEP_MINUTES * 60_000
// The year-lapse keeps the clock time and moves the date: a whole year in about 18 seconds.
const YEAR_DAYS_PER_SECOND = 20

const PHASE_BADGES: Record<Phase, { label: string; palette: string; icon: typeof SunIcon }> = {
  day: { label: 'Daylight', palette: 'yellow', icon: SunIcon },
  golden: { label: 'Golden hour', palette: 'orange', icon: Sunset },
  twilight: { label: 'Twilight', palette: 'purple', icon: Moon },
  night: { label: 'Night', palette: 'blue', icon: Moon },
}

const NIGHT_SKY = '#1e2747'
const LOW_SUN_SKY = '#f6ad55'
const DAY_SKY = '#fbe7a1'

// Shortcuts to the extremes of the year, keeping the time of day: at Helsinki's latitude the
// midsummer sun climbs to 53° but the midwinter sun only to 6.5°.
const SEASONS = [
  { label: 'Midsummer', month: 5, day: 21 },
  { label: 'Equinox', month: 8, day: 22 },
  { label: 'Midwinter', month: 11, day: 21 },
]

const VIEW_KEYS: Record<string, ViewMode> = { '1': 'free', '2': 'from-sun', '3': 'into-sun' }

const VIEW_MODES: { mode: ViewMode; label: string; icon: typeof SunIcon; title: string }[] = [
  { mode: 'free', label: 'Free', icon: Move, title: 'Move the camera freely' },
  { mode: 'from-sun', label: 'From the sun', icon: SunIcon, title: 'Look from where the sun is: everything you see is lit' },
  { mode: 'into-sun', label: 'Into the sun', icon: Eclipse, title: 'Look toward the sun: everything you see is in shade' },
]

type SunPanelProps = {
  date: Date
  sun: Sun
  onDateChange: (date: Date) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
}

export function SunPanel({ date, sun, onDateChange, viewMode, onViewModeChange }: SunPanelProps) {
  const phase = PHASE_BADGES[getPhase(sun.altitude)]
  // 'day' plays through the hours (and on into the night); 'year' through the dates.
  const [playMode, setPlayMode] = useState<'day' | 'year' | null>(null)
  // A hint on the slider until the sun has been moved once.
  const [moved, setMoved] = useState(false)
  // The animation loop reads the latest props without restarting on every frame.
  const latest = useRef({ date, sun, onDateChange, onViewModeChange })
  useEffect(() => {
    latest.current = { date, sun, onDateChange, onViewModeChange }
  })

  // Keyboard shortcuts: Space plays or pauses, ←/→ move 5 minutes, N jumps to now, 1–3 pick the view.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
      const { date: current, onDateChange: change, onViewModeChange: changeView } = latest.current
      if (event.key === ' ' && !target?.closest('button')) {
        event.preventDefault()
        setPlayMode((mode) => (mode ? null : 'day'))
        setMoved(true)
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (target?.closest('[role="slider"]')) return
        setPlayMode(null)
        setMoved(true)
        const step = Math.floor(current.getTime() / STEP_MS) + (event.key === 'ArrowRight' ? 1 : -1)
        change(new Date(step * STEP_MS))
      } else if (event.key === 'n' || event.key === 'N') {
        setPlayMode(null)
        change(new Date())
      } else if (event.key in VIEW_KEYS) {
        changeView(VIEW_KEYS[event.key])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // A little greeting when the time-lapse carries the sun over the horizon.
  const sunUp = sun.altitude > 0
  const wasSunUp = useRef(sunUp)
  useEffect(() => {
    if (wasSunUp.current === sunUp) return
    wasSunUp.current = sunUp
    if (playMode !== 'day') return
    const { sunrise, sunset, nextSunrise } = latest.current.sun
    const now = latest.current.date
    if (sunUp) {
      const daylight = sunrise && sunset ? (sunset.getTime() - sunrise.getTime()) / 60_000 : null
      toaster.create({
        type: 'info',
        title: 'Good morning ☀️',
        description: daylight ? `${formatDuration(daylight)} of daylight today.` : undefined,
        duration: 2500,
      })
    } else {
      toaster.create({
        type: 'info',
        title: "Sun's down 🌙",
        description: nextSunrise
          ? `Back in ${formatDuration((nextSunrise.getTime() - now.getTime()) / 60_000)}.`
          : undefined,
        duration: 2500,
      })
    }
  }, [sunUp, playMode])

  useEffect(() => {
    if (!playMode) return
    let current = latest.current.date.getTime()
    let lastStep = Math.floor(current / STEP_MS)
    let last = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      const elapsed = now - last
      if (playMode === 'year' && elapsed >= PLAYBACK_UPDATE_MS) {
        const days = Math.max(1, Math.round((elapsed / 1000) * YEAR_DAYS_PER_SECOND))
        const next = new Date(latest.current.date)
        next.setDate(next.getDate() + days)
        last = now
        latest.current.onDateChange(next)
      } else if (playMode === 'day' && elapsed >= PLAYBACK_UPDATE_MS) {
        const minutesPerSecond = playbackSpeed(latest.current.sun.altitude)
        current += (elapsed / 1000) * minutesPerSecond * 60_000
        last = now
        const step = Math.floor(current / STEP_MS)
        if (step !== lastStep) {
          lastStep = step
          latest.current.onDateChange(new Date(step * STEP_MS))
        }
      }
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playMode])

  function setMinutes(minutes: number) {
    setPlayMode(null)
    setMoved(true)
    const next = new Date(date)
    next.setHours(0, minutes, 0, 0)
    onDateChange(next)
  }

  function setCalendarDate(value: string) {
    const [year, month, day] = value.split('-').map(Number)
    if (!year || !month || !day) return
    setPlayMode(null)
    const next = new Date(date)
    next.setFullYear(year, month - 1, day)
    onDateChange(next)
  }

  return (
    <Panel bottom="4" left="3" right={{ base: '3', md: 'auto' }} width={{ md: 'md' }} p="4">
      <Stack gap="3">
        {/* Rows never wrap: their content changes width as time moves, and a row that
            reflows would make the panel jump. Wide rows scroll sideways on narrow phones. */}
        <HStack gap="2">
          <Text textStyle="3xl" fontWeight="800" letterSpacing="-0.02em" fontVariantNumeric="tabular-nums">
            {formatTime(date)}
          </Text>
          {/* Fixed width, so switching between "Night" and "Golden hour" moves nothing. */}
          <Badge colorPalette={phase.palette} borderRadius="full" size="md" minWidth="7.5rem" justifyContent="center">
            <phase.icon size={13} />
            {phase.label}
          </Badge>
          <Spacer />
          <Button
            size="sm"
            variant="outline"
            borderRadius="full"
            bg="white"
            flexShrink={0}
            onClick={() => {
              setPlayMode(null)
              onDateChange(new Date())
            }}
          >
            Now
          </Button>
        </HStack>

        <HStack gap="3">
          <IconButton
            size="sm"
            variant="subtle"
            borderRadius="full"
            aria-label={playMode === 'day' ? 'Pause' : 'Play time-lapse'}
            title={playMode === 'day' ? 'Pause' : 'Play the day (Space)'}
            colorPalette="orange"
            onClick={() => {
              setPlayMode(playMode === 'day' ? null : 'day')
              setMoved(true)
            }}
          >
            {playMode === 'day' ? <Pause /> : <Play />}
          </IconButton>
          <IconButton
            size="sm"
            variant={playMode === 'year' ? 'solid' : 'subtle'}
            borderRadius="full"
            colorPalette="orange"
            aria-label={playMode === 'year' ? 'Pause' : 'Play the year at this time of day'}
            title={playMode === 'year' ? 'Pause' : 'Play the year at this time of day'}
            onClick={() => {
              setPlayMode(playMode === 'year' ? null : 'year')
              setMoved(true)
              if (playMode !== 'year') {
                toaster.create({
                  type: 'info',
                  title: 'Year-lapse',
                  description: `The same time, ${formatTime(date)}, on every day of the year: watch the shadows stretch toward midwinter and shrink toward midsummer.`,
                  duration: 4000,
                })
              }
            }}
          >
            {playMode === 'year' ? <Pause /> : <CalendarRange />}
          </IconButton>
          <Slider.Root
            flex="1"
            position="relative"
            min={0}
            max={MINUTES_PER_DAY - 1}
            step={STEP_MINUTES}
            value={[date.getHours() * 60 + date.getMinutes()]}
            onValueChange={({ value }) => setMinutes(value[0])}
            aria-label={['Time of day']}
          >
            <Slider.Control>
              <Slider.Track height="2" borderRadius="full" bg={skyGradient(sun)} />
              <Slider.Thumbs />
            </Slider.Control>
            {!moved && (
              // The outer box centres the hint over the thumb; the bounce animates its own transform.
              <Box
                position="absolute"
                bottom="100%"
                mb="2"
                left={`${((date.getHours() * 60 + date.getMinutes()) / MINUTES_PER_DAY) * 100}%`}
                transform="translateX(-50%)"
                pointerEvents="none"
              >
                <Badge
                  colorPalette="orange"
                  variant="solid"
                  borderRadius="full"
                  animation="bounce 1.6s infinite"
                  whiteSpace="nowrap"
                >
                  Drag to move the sun
                </Badge>
              </Box>
            )}
          </Slider.Root>
        </HStack>

        <HStack gap="1.5" overflowX="auto" css={{ scrollbarWidth: 'none' }}>
          <Input
            type="date"
            size="xs"
            width="auto"
            flexShrink={0}
            borderRadius="full"
            bg="white"
            value={toDateInputValue(date)}
            onChange={(event) => setCalendarDate(event.target.value)}
            aria-label="Date"
          />
          {SEASONS.map(({ label, month, day }) => {
            const active = date.getMonth() === month && date.getDate() === day
            return (
              <Button
                key={label}
                size="xs"
                flexShrink={0}
                borderRadius="full"
                variant={active ? 'solid' : 'outline'}
                colorPalette={active ? 'orange' : 'gray'}
                bg={active ? undefined : 'white'}
                onClick={() => {
                  setPlayMode(null)
                  const next = new Date(date)
                  next.setMonth(month, day)
                  onDateChange(next)
                }}
              >
                {label}
              </Button>
            )
          })}
        </HStack>

        <HStack>
          <Group attached>
            {VIEW_MODES.map(({ mode, label, icon: Icon, title }) => (
              <IconButton
                key={mode}
                size="xs"
                px="2.5"
                variant={viewMode === mode ? 'solid' : 'outline'}
                colorPalette={viewMode === mode ? 'orange' : 'gray'}
                bg={viewMode === mode ? undefined : 'white'}
                onClick={() => onViewModeChange(mode)}
                aria-label={label}
                title={title}
              >
                <Icon />
                <Box as="span" display={{ base: 'none', sm: 'inline' }}>
                  {label}
                </Box>
              </IconButton>
            ))}
          </Group>
        </HStack>

        <Stack
          direction={{ base: 'column', sm: 'row' }}
          justify="space-between"
          gap={{ base: '0', sm: '3' }}
          textStyle="xs"
          color="fg.muted"
          whiteSpace="nowrap"
        >
          <Text>{describeDay(sun, date)}</Text>
          <Text>{describePosition(sun)}</Text>
        </Stack>
      </Stack>
    </Panel>
  )
}

/** Time-lapse speed, easing from day speed at sunset to night speed when twilight ends. */
function playbackSpeed(altitude: number): number {
  const darkness = Math.min(1, Math.max(0, altitude / CIVIL_TWILIGHT))
  return DAY_SPEED_MINUTES_PER_SECOND + (NIGHT_SPEED_MINUTES_PER_SECOND - DAY_SPEED_MINUTES_PER_SECOND) * darkness
}

/** "↑ 07:42 ↓ 18:31 · Golden hour in 1 h 20 min": the day's times and what comes next. */
function describeDay({ sunrise, sunset, goldenHour, nextSunrise, alwaysUp, alwaysDown }: Sun, date: Date): string {
  if (alwaysUp) return 'Sun up all day'
  if (alwaysDown) return 'Sun down all day'
  const times = [sunrise && `↑ ${formatTime(sunrise)}`, sunset && `↓ ${formatTime(sunset)}`].filter(Boolean)
  const until = (event: Date) => formatDuration(Math.max(1, (event.getTime() - date.getTime()) / 60_000))
  let next: string | null = null
  if (sunrise && date < sunrise) next = `Sunrise in ${until(sunrise)}`
  else if (goldenHour && date < goldenHour) next = `Golden hour in ${until(goldenHour)}`
  else if (sunset && date < sunset) next = `Sunset in ${until(sunset)}`
  else if (nextSunrise) next = `Sunrise in ${until(nextSunrise)}`
  return [times.join(' '), next].filter(Boolean).join(' · ')
}

function describePosition({ altitude, azimuth }: Sun): string {
  if (altitude <= 0) return `Sun ${Math.round(-altitude)}° below the horizon`
  return `Sun ${Math.round(altitude)}° high in the ${compassPoint(azimuth)} (${Math.round(azimuth)}°)`
}

/** A track background that runs from night through sunrise and day to sunset. */
function skyGradient({ sunrise, sunset, alwaysUp, alwaysDown }: Sun): string {
  if (alwaysUp) return DAY_SKY
  if (alwaysDown || !sunrise || !sunset) return NIGHT_SKY

  const rise = (dayFraction(sunrise) * 100).toFixed(1)
  const set = (dayFraction(sunset) * 100).toFixed(1)
  return `linear-gradient(90deg,
    ${NIGHT_SKY} calc(${rise}% - 4%), ${LOW_SUN_SKY} ${rise}%, ${DAY_SKY} calc(${rise}% + 6%),
    ${DAY_SKY} calc(${set}% - 6%), ${LOW_SUN_SKY} ${set}%, ${NIGHT_SKY} calc(${set}% + 4%))`
}

function dayFraction(date: Date): number {
  return (date.getHours() * 60 + date.getMinutes()) / MINUTES_PER_DAY
}

function toDateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
