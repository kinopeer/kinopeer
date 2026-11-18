import { useMemo, useState } from 'react'
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
 * this browser's guesses, as Downloads does. The same map while a poll changes nothing a mark shows,
 * so a screen showing the cards renders again only when one does.
 */
export function useTitlesInDownloads(): ReadonlyMap<string, DownloadsMark> {
  const torrents = useLastTorrents()
  const server = useServerMatches()
  const language = useTmdbLanguage()
  const marks = useMemo(
    () => (torrents && server ? marksByTitle(torrentsByTitle(torrents, server, (key) => cachedTitle(language, key))) : NONE),
    [torrents, server, language],
  )
  // The marks last given out, kept while new ones show the same.
  const [shown, setShown] = useState(marks)
  const same = shown === marks || sameMarks(shown, marks)
  if (!same) setShown(marks)
  return same ? shown : marks
}
