import { useCallback } from 'react'
import type { Torrent } from '../api/qbittorrent'
import { useTmdbLanguage } from '../settings/settings'
import { marksByTitle, sameMarks, torrentsByTitle, type DownloadsMark } from './titleDownloads'
import { useLastTorrents } from './useMainData'
import { useServerMatches } from './useServerMatches'
import { cachedTitle } from './useTitleMatches'

const NONE = new Map<string, DownloadsMark>()

/**
 * The "In downloads" mark of each title known to be in downloads, by `titleKey`, for the title cards
 * outside Downloads (#460): only titles known without TMDB (`torrentsByTitle`), from the torrents
 * `useLastTorrents` has, so it starts no poll and no lookup. Empty until the torrents and the
 * server's matches are here, or the server failed to give them: then the cards go by the tags and
 * this browser's guesses, as Downloads does. The marks are worked out inside the subscription, so
 * a poll that changes no mark (`sameMarks`) renders nothing.
 */
export function useTitlesInDownloads(): ReadonlyMap<string, DownloadsMark> {
  const server = useServerMatches()
  const language = useTmdbLanguage()
  const select = useCallback(
    (torrents: Torrent[] | undefined) =>
      torrents && server ? marksByTitle(torrentsByTitle(torrents, server, (key) => cachedTitle(language, key))) : NONE,
    [server, language],
  )
  return useLastTorrents(select, sameMarks)
}
