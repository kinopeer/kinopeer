import { useMemo } from 'react'
import type { Torrent } from '../api/qbittorrent'
import { useTmdbLanguage } from '../settings/settings'
import { torrentsByTitle } from './titleDownloads'
import { useLastTorrents } from './useMainData'
import { useServerMatches } from './useServerMatches'
import { cachedTitle } from './useTitleMatches'

const NONE = new Map<string, Torrent[]>()

/**
 * The torrents of each title known to be in downloads, by `titleKey`, for the title cards outside
 * Downloads (#460): only titles known without TMDB (`torrentsByTitle`), from the torrents
 * `useLastTorrents` has, so it starts no poll and no lookup. Empty until the torrents and the
 * server's matches are here: a tag alone could name another title than the user chose.
 */
export function useTitlesInDownloads(): Map<string, Torrent[]> {
  const torrents = useLastTorrents()
  const server = useServerMatches()
  const language = useTmdbLanguage()
  return useMemo(
    () => (torrents && server ? torrentsByTitle(torrents, server, (key) => cachedTitle(language, key)) : NONE),
    [torrents, server, language],
  )
}
