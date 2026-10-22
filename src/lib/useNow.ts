import { useEffect, useState } from 'react'

/** The current time, updated every `interval` ms, for labels like "updated 3 min ago". */
export function useNow(interval = 30_000): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(timer)
  }, [interval])
  return now
}
