import { useEffect, useRef, useState } from 'react'

/** Follows `value`, changing at most once per `intervalMs` and always ending on the latest value. */
export function useThrottled<T>(value: T, intervalMs: number): T {
  const [throttled, setThrottled] = useState(value)
  const lastUpdate = useRef(0)

  useEffect(() => {
    const update = () => {
      lastUpdate.current = Date.now()
      setThrottled(value)
    }
    const wait = lastUpdate.current + intervalMs - Date.now()
    if (wait <= 0) {
      update()
      return
    }
    const timer = setTimeout(update, wait)
    return () => clearTimeout(timer)
  }, [value, intervalMs])

  return throttled
}
