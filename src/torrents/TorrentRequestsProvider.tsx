import { useState, type ReactNode } from 'react'
import { createTorrentRequests } from './torrentRequests'
import { TorrentRequestsContext } from './useTorrentRequests'

/**
 * One set of requests about a torrent (moving its files, its speed limits) for the screens under it,
 * so a sheet in the drawer sees a request Downloads sent under it, and the other way round.
 */
export function TorrentRequestsProvider({ children }: { children: ReactNode }) {
  const [requests] = useState(createTorrentRequests)
  return <TorrentRequestsContext value={requests}>{children}</TorrentRequestsContext>
}
