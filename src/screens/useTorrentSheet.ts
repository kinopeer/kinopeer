import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Torrent } from '../api/qbittorrent'
import { useTorrentOverlay } from './useTorrentOverlay'

/** How a request settled, and whether a sheet still showed its torrent then (else the outcome is
 *  said elsewhere, in a toast). */
export type Settled = { showing: boolean } & ({ ok: true } | { ok: false; error: unknown })

export interface TorrentSheet<Payload> {
  /** The torrent the sheet shows, while it's open and its torrent is among the screen's. */
  torrent: Torrent | undefined
  /** Opens the sheet for a torrent among the screen's. */
  open: (hash: string) => void
  close: () => void
  /** What's being sent for a torrent, while it is: a sheet for it, opened again or not, shows it busy. */
  pending: (hash: string) => Payload | undefined
  /** The last request for the sheet's torrent failed while a sheet showed it: what it sent and why.
   *  Gone when a sheet opens or sends again. */
  failure: { sent: Payload; error: unknown } | undefined
  /** Sends a request for a torrent, which outlives the sheet, and says how it settled. */
  send: (target: Torrent, payload: Payload, request: () => Promise<void>) => Promise<Settled>
}

/**
 * A screen's sheet for one of its torrents (Move files, Speed limits) and the requests it sends. The
 * sheet closes when its torrent goes away or another torrent with the same hash replaces it, and
 * stays closed when that torrent comes back (`useTorrentOverlay`). A request outlives the sheet: each torrent's stays
 * pending until it settles, and then says whether a sheet still shows that torrent (the one that
 * sent it or one opened since), so the feature knows where to say how it went. A failure a sheet
 * shows stays here, for the sheet to say.
 */
export function useTorrentSheet<Payload>(torrents: Record<string, Torrent> | undefined): TorrentSheet<Payload> {
  const overlay = useTorrentOverlay(torrents)
  const { torrent } = overlay
  // What's being sent, by torrent: one request per torrent at a time, whichever sheet sent it. By hash
  // alone, not when it was added: qBittorrent applies a request to the hash, so one still in flight
  // for a torrent deleted and added again goes to the new one, and its sheet shows it busy rather
  // than letting it go out twice.
  const [inFlight, setInFlight] = useState<ReadonlyMap<string, Payload>>(() => new Map())
  // The torrent the sheet shows, read when a request settles: set right away by open and close, which
  // may run outside an event React renders at once (a sheet dragged away closes when its animation
  // ends), and as each render commits, for a torrent that went away meanwhile.
  const shown = useRef<Torrent | undefined>(undefined)
  useLayoutEffect(() => {
    shown.current = torrent
  })
  // A screen that's gone shows no sheet: a request that settles after it says so elsewhere.
  useEffect(
    () => () => {
      shown.current = undefined
    },
    [],
  )
  // Kept only while a sheet shows the request's torrent, and cleared by open: always the shown torrent's.
  const [failed, setFailed] = useState<{ sent: Payload; error: unknown } | null>(null)

  const { open: openOverlay, close: closeOverlay } = overlay
  const open = useCallback(
    (hash: string) => {
      const next = openOverlay(hash)
      if (!next) return
      shown.current = next
      setFailed(null)
    },
    [openOverlay],
  )
  const close = useCallback(() => {
    shown.current = undefined
    closeOverlay()
  }, [closeOverlay])
  const showing = (target: Torrent) =>
    shown.current?.hash === target.hash && shown.current.added_on === target.added_on
  const pending = (hash: string) => inFlight.get(hash)

  const send = async (target: Torrent, payload: Payload, request: () => Promise<void>): Promise<Settled> => {
    setInFlight((current) => new Map(current).set(target.hash, payload))
    setFailed(null)
    try {
      await request()
      return { ok: true, showing: showing(target) }
    } catch (error) {
      if (!showing(target)) return { ok: false, error, showing: false }
      setFailed({ sent: payload, error })
      return { ok: false, error, showing: true }
    } finally {
      setInFlight((current) => {
        const next = new Map(current)
        next.delete(target.hash)
        return next
      })
    }
  }
  return { torrent, open, close, pending, failure: failed ?? undefined, send }
}
