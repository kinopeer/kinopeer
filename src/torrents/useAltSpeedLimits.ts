import { useCallback, useState } from 'react'
import { toggleSpeedLimitsMode } from '../api/qbittorrent'
import type { MainDataState } from './useMainData'

export interface AltSpeedLimits {
  /** Whether the alternative limits apply; undefined until qBittorrent says. */
  on: boolean | undefined
  /** Nothing to toggle: qBittorrent doesn't answer, hasn't said yet, or a switch is on its way. */
  disabled: boolean
  toggle: () => void
}

/**
 * qBittorrent's alternative speed limits, read from the caller's `useMainData()` server state (so
 * no second poll starts). A toggle shows the new state right away and keeps it until the first poll
 * after the request, which then decides even if it disagrees (qBittorrent's scheduler or its own UI
 * switched them back), or drops it if the request fails.
 */
export function useAltSpeedLimits({ data, offline, updatedAt, refresh }: MainDataState): AltSpeedLimits {
  const polled = data?.server.use_alt_speed_limits
  // The state asked for, and when qBittorrent took the request (Infinity while it's on its way):
  // a poll that arrives after that has the final word.
  const [wanted, setWanted] = useState<{ on: boolean; after: number } | null>(null)
  if (wanted && updatedAt !== null && updatedAt > wanted.after) setWanted(null)

  const on = wanted ? wanted.on : polled
  const sending = wanted?.after === Infinity
  const toggle = useCallback(() => {
    if (on === undefined) return
    setWanted({ on: !on, after: Infinity })
    toggleSpeedLimitsMode().then(
      () => {
        setWanted({ on: !on, after: Date.now() })
        refresh()
      },
      () => setWanted(null),
    )
  }, [on, refresh])

  return { on, disabled: offline || on === undefined || sending, toggle }
}
