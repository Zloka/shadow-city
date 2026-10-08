const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function formatTime(date: Date): string {
  return timeFormat.format(date)
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  if (hours === 0) return `${rest} min`
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

export function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(1)} km`
}
