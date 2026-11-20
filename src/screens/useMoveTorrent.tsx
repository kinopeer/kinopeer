import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { setTorrentLocation, type Torrent } from '../api/qbittorrent'
import { useToast } from '../components/Toast'
import { REQUEST_KINDS } from '../torrents/requestKinds'
import { folderFailure } from './folderFailure'
import { MoveTorrentSheet } from './MoveTorrentSheet'
import { useTorrentSheet } from './useTorrentSheet'

export interface MoveTorrent {
  /** Opens "Move files" for a torrent in `torrents`. */
  open: (hash: string) => void
  /** The sheet, for the screen to render. */
  element: ReactNode
}

/**
 * "Move files" for a screen: the sheet for one of its torrents, and the move itself, which outlives
 * the sheet, so a move that fails after the sheet was closed (or its torrent went away, or the screen)
 * still says so in a toast, as a move that went through does.
 */
export function useMoveTorrent({ torrents, offline, refresh }: {
  /** The screen's torrents: the sheet is for one of them, and closes when it's gone. */
  torrents: Record<string, Torrent> | undefined
  offline: boolean
  /** After qBittorrent took the folder, so the screen shows it right away. */
  refresh: () => void
}): MoveTorrent {
  const { torrent, open, close, pending, failure, send } = useTorrentSheet<string>(REQUEST_KINDS.move, torrents)
  const { t } = useTranslation()
  const toast = useToast()

  const move = async (target: Torrent, location: string) => {
    const settled = await send(target, location, () => setTorrentLocation([target.hash], location))
    if (!settled) return
    // A sheet that shows the torrent closed on its own, or kept the failure to say it.
    if (settled.ok) {
      toast.show(t('move.moved', { location }), { icon: 'folder' })
      refresh()
    } else if (!settled.showing) {
      toast.show(t(folderFailure(settled.error)), { icon: 'alert' })
    }
  }

  const element = torrent && (
    <MoveTorrentSheet
      key={torrent.hash}
      torrent={torrent}
      offline={offline}
      pending={pending(torrent.hash)}
      failure={failure && folderFailure(failure.error)}
      onMove={(location) => void move(torrent, location)}
      onClose={close}
    />
  )
  return { open, element }
}
