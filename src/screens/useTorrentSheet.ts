import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Torrent } from '../api/qbittorrent'

export interface TorrentSheet {
  /** The torrent the sheet shows, while it's open and its torrent is among the screen's. */
  torrent: Torrent | undefined
  /** Opens the sheet for a torrent among the screen's. */
  open: (hash: string) => void
  close: () => void
  /** Whether a sheet shows this torrent now, for a request it sent that settles later: the sheet
   *  may have been closed, or its torrent gone or replaced by another with the same hash. */
  showing: (target: Torrent) => boolean
}

/**
 * Which torrent a screen's per-torrent sheet (Move files, Speed limits) is open for. The sheet closes
 * when its torrent goes away or another torrent with the same hash replaces it, and stays closed when
 * that torrent comes back. A request the sheet sends outlives it, so the hook that sends it keeps
 * whether it's in flight and how it went, and asks `showing` where to say so.
 */
export function useTorrentSheet(torrents: Record<string, Torrent> | undefined): TorrentSheet {
  // The torrent the sheet is open for, by when it was added: one re-added with the same hash is
  // another torrent, so the sheet doesn't come back for it.
  const [opened, setOpened] = useState<{ hash: string; addedOn: number } | null>(null)
  const candidate = opened ? torrents?.[opened.hash] : undefined
  const torrent = candidate?.added_on === opened?.addedOn ? candidate : undefined
  // Gone (deleted elsewhere) or replaced: forgotten, so the sheet doesn't open again when the same
  // torrent is back.
  if (opened && torrents && !torrent) setOpened(null)
  // The torrent the sheet shows, read when a request settles: set as each render commits, before
  // anything else can run, so a request never sees a sheet that's gone.
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

  const open = useCallback(
    (hash: string) => {
      const next = torrents?.[hash]
      if (!next) return
      setOpened({ hash, addedOn: next.added_on })
    },
    [torrents],
  )
  const close = useCallback(() => setOpened(null), [])
  const showing = useCallback(
    (target: Torrent) => shown.current?.hash === target.hash && shown.current.added_on === target.added_on,
    [],
  )
  return { torrent, open, close, showing }
}
