import { useCallback, useState } from 'react'
import type { Torrent } from '../api/qbittorrent'

/** A torrent as an overlay remembers it: by when it was added too, since one re-added with the same
 *  hash is another torrent. */
export interface TorrentRef {
  hash: string
  addedOn: number
}

export const refTo = (torrent: Torrent): TorrentRef => ({ hash: torrent.hash, addedOn: torrent.added_on })

/** The torrent `ref` names among `torrents`, unless it went away or another with the same hash replaced it. */
export function findTorrent(torrents: Record<string, Torrent> | undefined, ref: TorrentRef): Torrent | undefined {
  const candidate = torrents?.[ref.hash]
  return candidate?.added_on === ref.addedOn ? candidate : undefined
}

export interface TorrentOverlay {
  /** The torrent the overlay is open for, while it's among the screen's. */
  torrent: Torrent | undefined
  /** Opens the overlay for a torrent among the screen's, and returns it. */
  open: (hash: string) => Torrent | undefined
  close: () => void
}

/**
 * Which of a screen's torrents an overlay (a menu, a sheet, a confirmation) is open for. It closes
 * when that torrent goes away or another torrent with the same hash replaces it, so a confirmation
 * never acts on the torrent that replaced its own, and stays closed when that torrent comes back.
 */
export function useTorrentOverlay(torrents: Record<string, Torrent> | undefined): TorrentOverlay {
  const [opened, setOpened] = useState<TorrentRef | null>(null)
  const torrent = opened ? findTorrent(torrents, opened) : undefined
  // Gone (deleted elsewhere) or replaced: forgotten, so the overlay doesn't open again when the same
  // torrent is back. Not before the screen's first answer, when it has no torrents yet.
  if (opened && torrents && !torrent) setOpened(null)

  const open = useCallback(
    (hash: string) => {
      const next = torrents?.[hash]
      if (next) setOpened(refTo(next))
      return next
    },
    [torrents],
  )
  const close = useCallback(() => setOpened(null), [])
  return { torrent, open, close }
}
