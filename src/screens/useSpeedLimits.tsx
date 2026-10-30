import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { setSpeedLimits, type Torrent } from '../api/qbittorrent'
import { useToast } from '../components/Toast'
import { SpeedLimitsSheet, type SpeedLimitsChange } from './SpeedLimitsSheet'
import { useTorrentSheet } from './useTorrentSheet'

export interface SpeedLimits {
  /** Opens "Speed limits" for a torrent in `torrents`. */
  open: (hash: string) => void
  /** The sheet, for the screen to render. */
  element: ReactNode
}

/**
 * "Speed limits" for a screen, in the shape of `useMoveTorrent`: the sheet for one of its torrents,
 * and the save itself, which outlives the sheet. A sheet for that torrent, the one that sent the save
 * or one opened again since (which starts from the limits being saved), shows it in flight, closes
 * when it's saved and says when it failed; with no such sheet, a failure is a toast.
 */
export function useSpeedLimits({ torrents, offline, refresh, titleOf }: {
  /** The screen's torrents: the sheet is for one of them, and closes when it's gone. */
  torrents: Record<string, Torrent> | undefined
  offline: boolean
  /** After a save, so the screen shows what qBittorrent took. */
  refresh: () => void
  /** The torrent's name as the screen shows it. */
  titleOf: (torrent: Torrent) => string
}): SpeedLimits {
  const { t } = useTranslation()
  const { torrent, open, close, pending, failure, send } = useTorrentSheet<SpeedLimitsChange>(torrents)
  const toast = useToast()

  const save = async (target: Torrent, limits: SpeedLimitsChange) => {
    const settled = await send(target, limits, () => setSpeedLimits([target.hash], limits))
    // Either way, show what qBittorrent took: after a failure one of the two may have gone through.
    refresh()
    if (settled.ok) {
      if (settled.showing) close()
    } else if (!settled.showing) {
      toast(t('limits.failedClosed', { title: titleOf(target) }), { icon: 'alert' })
    }
  }

  const element = torrent && (
    <SpeedLimitsSheet
      key={torrent.hash}
      torrent={torrent}
      title={titleOf(torrent)}
      offline={offline}
      pending={pending(torrent.hash)}
      failure={failure?.sent}
      onSave={(limits) => void save(torrent, limits)}
      onClose={close}
    />
  )
  return { open, element }
}
