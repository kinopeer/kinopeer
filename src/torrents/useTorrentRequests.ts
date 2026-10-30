import { createContext, useContext, useState } from 'react'
import { createTorrentRequests, type TorrentRequests } from './torrentRequests'

/** The app's requests about one torrent, provided by `TorrentRequestsProvider`. */
export const TorrentRequestsContext = createContext<TorrentRequests | null>(null)

/**
 * The requests about one torrent in flight. Inside `TorrentRequestsProvider` every screen shares them;
 * elsewhere, as in tests, the caller keeps its own.
 */
export function useTorrentRequests(): TorrentRequests {
  const shared = useContext(TorrentRequestsContext)
  const [own] = useState(() => (shared ? null : createTorrentRequests()))
  return shared ?? own!
}
