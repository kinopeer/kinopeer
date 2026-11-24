import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { renameFiles, type Torrent } from '../api/qbittorrent'
import { useToast } from '../components/Toast'
import { useSettings } from '../settings/settings'
import { REQUEST_KINDS } from '../torrents/requestKinds'
import { folderTakenBy, titleName, torrentsIn } from '../torrents/mediaNames'
import type { TitleMatch } from '../torrents/titleLookup'
import { MediaNamesSheet, type NamesChange } from './MediaNamesSheet'
import { useTorrentSheet } from './useTorrentSheet'

export interface MediaNames {
  /** Opens "Name for a media server" for a torrent in `torrents` matched to a movie or a series. */
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
  /** The title the torrent is matched to: a movie's or a series' files are named by it. */
  matchOf: (torrent: Torrent) => TitleMatch | null | undefined
}): MediaNames {
  const { t } = useTranslation()
  const { torrent, open, close, pending, failure, send } = useTorrentSheet<NamesChange>(REQUEST_KINDS.names, torrents)
  const toast = useToast()
  const [settings] = useSettings()

  const rename = async (target: Torrent, change: NamesChange) => {
    const title = matchOf(target)?.title ?? target.name
    const settled = await send(target, change, () => renameFiles(target.hash, change.renames))
    if (!settled) return
    if (settled.ok) toast.show(change.mode === 'restore' ? t('names.restored', { title }) : t('names.renamed', { title }))
    else if (!settled.showing) toast.show(t('names.failedClosed', { title }), { icon: 'alert' })
  }

  /** The sheet for a matched torrent: a movie's folder is its own, while a series' seasons share the show's, so the sheet reads the files of the torrents there and checks them against its own. */
  const sheet = (shown: Torrent, match: TitleMatch) => {
    const tmdbId = settings.tmdbIds ? match.id : undefined
    const folder = titleName(match.title, match.year, match.type, tmdbId)
    const others = Object.values(listed ?? {})
    return (
      <MediaNamesSheet
        key={shown.hash}
        torrent={shown}
        type={match.type}
        title={match.title}
        year={match.year}
        tmdbId={tmdbId}
        taken={match.type === 'movie' ? folderTakenBy(others, shown, folder)?.name : undefined}
        neighbours={match.type === 'tv' ? torrentsIn(others, shown, folder) : []}
        offline={offline}
        pending={pending(shown.hash)}
        failure={failure}
        onSend={(change) => void rename(shown, change)}
        onClose={close}
      />
    )
  }
  const match = torrent && matchOf(torrent)
  const element = torrent && match && sheet(torrent, match)
  return { open, element }
}
