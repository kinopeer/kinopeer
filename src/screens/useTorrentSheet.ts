import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Torrent } from '../api/qbittorrent'
import { requestKey, type Settled } from '../torrents/torrentRequests'
import { useTorrentRequests } from '../torrents/useTorrentRequests'
import { useTorrentOverlay } from './useTorrentOverlay'

export type { Settled } from '../torrents/torrentRequests'

export interface TorrentSheet<Payload> {
  /** The torrent the sheet shows, while it's open and its torrent is among the screen's. */
  torrent: Torrent | undefined
  /** Opens the sheet for a torrent among the screen's. */
  open: (hash: string) => void
  close: () => void
  /** What's being sent for a torrent, while it is, from any screen: a sheet for it shows it busy. */
  pending: (hash: string) => Payload | undefined
  /** The last request for the sheet's torrent failed while a sheet showed it: what it sent and why.
   *  Gone when a sheet opens or sends again. */
  failure: { sent: Payload; error: unknown } | undefined
  /**
   * Sends a request for a torrent, which outlives the sheet, and says how it settled; nothing when
   * one of this kind is already in flight for it.
   */
  send: (target: Torrent, payload: Payload, request: () => Promise<void>) => Promise<Settled | undefined>
}

/**
 * A screen's sheet of one kind (Move files, Speed limits) for one of its torrents, and the requests it
 * sends. The sheet closes when its torrent goes away or another torrent with the same hash replaces
 * it, and stays closed when that torrent comes back (`useTorrentOverlay`). The requests are the app's
 * (`useTorrentRequests`), shared with the same kind of sheet on other screens: one per torrent at a
 * time, shown busy in any sheet for it, and when it settles every sheet that shows the torrent then
 * (the one that sent it, one opened again since, one on another screen) closes, or keeps the failure
 * to say it. `send` says whether one did, so the feature knows to say it elsewhere otherwise.
 */
export function useTorrentSheet<Payload>(kind: string, torrents: Record<string, Torrent> | undefined): TorrentSheet<Payload> {
  const overlay = useTorrentOverlay(torrents)
  const { torrent } = overlay
  const requests = useTorrentRequests()
  const inFlight = useSyncExternalStore(requests.subscribe, requests.getSnapshot)
  // The torrent the sheet shows, read when a request settles: set right away by open and close, which
  // may run outside an event React renders at once (a sheet dragged away closes when its animation
  // ends), and as each render commits, for a torrent that went away meanwhile.
  const shown = useRef<Torrent | undefined>(undefined)
  useLayoutEffect(() => {
    shown.current = torrent
  })
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

  // While the screen is here, it hears how each request of its kind settled, whichever screen sent it.
  useEffect(() => {
    const stop = requests.watch(kind, {
      shows: (target) => shown.current?.hash === target.hash && shown.current.added_on === target.added_on,
      settled: (outcome, sent) => {
        if (outcome.ok) close()
        else setFailed({ sent: sent as Payload, error: outcome.error })
      },
    })
    return () => {
      stop()
      // A screen that's gone shows no sheet: a request that settles after it says so elsewhere.
      shown.current = undefined
    }
  }, [requests, kind, close])

  const pending = (hash: string) => inFlight.get(requestKey(kind, hash)) as Payload | undefined
  const send = (target: Torrent, payload: Payload, request: () => Promise<void>) => {
    setFailed(null)
    return requests.send(kind, target, payload, request)
  }
  return { torrent, open, close, pending, failure: failed ?? undefined, send }
}
