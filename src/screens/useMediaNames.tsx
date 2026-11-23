import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { renameFiles, type Torrent } from '../api/qbittorrent'
import { useToast } from '../components/Toast'
import { REQUEST_KINDS } from '../torrents/requestKinds'
import { folderTakenBy, movieName } from '../torrents/mediaNames'
import type { TitleMatch } from '../torrents/titleLookup'
import { MediaNamesSheet, type NamesChange } from './MediaNamesSheet'
import { useTorrentSheet } from './useTorrentSheet'

export interface MediaNames {
  /** Opens "Name for a media server" for a torrent in `torrents` matched to a movie. */
  open: (hash: string) => void
  /** The sheet, for the screen to render. */
  element: ReactNode
}

/**
 * "Name for a media server" for a screen, in the shape of `useSpeedLimits`: the sheet for one of its
 * torrents, and the renames themselves, which outlive it (`useTorrentSheet`, kind `names`). Once
 * qBittorrent took them a toast says so; a failure stays in the sheet that shows the torrent, else
 * it's a toast. Nothing to refresh: the torrents' poll has no file names, and the Files section
 * polls its own.
 */
export function useMediaNames({ torrents, listed = torrents, offline, matchOf }: {
  /** The screen's torrents: the sheet is for one of them, and closes when it's gone. */
  torrents: Record<string, Torrent> | undefined
  /** Every torrent qBittorrent lists, when the screen shows fewer: another one may be in the folder naming would use. */
  listed?: Record<string, Torrent>
  offline: boolean
  /** The title the torrent is matched to: only a movie's files are named. */
  matchOf: (torrent: Torrent) => TitleMatch | null | undefined
}): MediaNames {
  const { t } = useTranslation()
  const { torrent, open, close, pending, failure, send } = useTorrentSheet<NamesChange>(REQUEST_KINDS.names, torrents)
  const toast = useToast()

  const rename = async (target: Torrent, change: NamesChange) => {
    const title = matchOf(target)?.title ?? target.name
    const settled = await send(target, change, () => renameFiles(target.hash, change.renames))
    if (!settled) return
    if (settled.ok) toast.show(change.mode === 'restore' ? t('names.restored', { title }) : t('names.renamed', { title }))
    else if (!settled.showing) toast.show(t('names.failedClosed', { title }), { icon: 'alert' })
  }

  const match = torrent && matchOf(torrent)
  const element = torrent && match?.type === 'movie' && (
    <MediaNamesSheet
      key={torrent.hash}
      torrent={torrent}
      title={match.title}
      year={match.year}
      taken={folderTakenBy(Object.values(listed ?? {}), torrent, movieName(match.title, match.year))?.name}
      offline={offline}
      pending={pending(torrent.hash)}
      failed={failure !== undefined}
      onSend={(change) => void rename(torrent, change)}
      onClose={close}
    />
  )
  return { open, element }
}
