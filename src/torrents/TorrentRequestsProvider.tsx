import { useContext, useState, type ReactNode } from 'react'
import { createTorrentRequests } from './torrentRequests'
import { MainDataContext } from './useMainData'
import { TorrentRequestsContext } from './useTorrentRequests'

/**
 * One set of requests about torrents (moving files, speed limits, pausing and resuming) for the
 * screens under it, so a sheet in the drawer sees a request Downloads sent under it, and the other
 * way round. Inside a `MainDataProvider` it's linked to that poll: a request that expects a state
 * polls again, and `useMainData` shows the state until a poll has it.
 */
export function TorrentRequestsProvider({ children }: { children: ReactNode }) {
  const poll = useContext(MainDataContext)
  const [requests] = useState(() => createTorrentRequests(poll ?? undefined))
  return <TorrentRequestsContext value={requests}>{children}</TorrentRequestsContext>
}
