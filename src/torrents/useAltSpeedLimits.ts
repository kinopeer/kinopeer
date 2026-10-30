import { useCallback, useState } from 'react'
import { UnauthorizedError, toggleSpeedLimitsMode } from '../api/qbittorrent'
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
 * no second poll starts); one caller per layout owns the switch. A toggle shows the new state right
 * away and keeps it until a poll sent after qBittorrent took the request, which then decides even
 * if it disagrees (qBittorrent's scheduler or its own UI switched them back). A failed request drops
 * it and calls `onFailed`, for the caller to say so; an expired session goes through the poll, which
 * reports it.
 */
export function useAltSpeedLimits(
  { data, offline, requestedAt, refresh }: MainDataState,
  onFailed: () => void,
): AltSpeedLimits {
  const polled = data?.server.use_alt_speed_limits
  // The state asked for, and when qBittorrent took the request (Infinity while it's on its way). A
  // poll already on its way then was sent before the switch, so only a later one has the final word.
  const [wanted, setWanted] = useState<{ on: boolean; after: number } | null>(null)
  if (wanted && requestedAt !== null && requestedAt > wanted.after) setWanted(null)

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
      (error: unknown) => {
        setWanted(null)
        // The poll gets the same 403 and hands it to the session's handler.
        if (error instanceof UnauthorizedError) refresh()
        else onFailed()
      },
    )
  }, [on, refresh, onFailed])

  return { on, disabled: offline || on === undefined || sending, toggle }
}
