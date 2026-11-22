import type { IconName } from '../components/Icon'
import { useMainData } from '../torrents/useMainData'
import { UnreachableState } from './UnreachableState'

export interface StoreUnreadStateProps {
  onRetry: () => void
  retryIcon?: IconName
}

/**
 * In the WebUI build, qBittorrent didn't give what it keeps for Kinopeer (the TMDB key,
 * `TmdbKeyReadError`; Prowlarr's address and key, `ProwlarrKeyReadError`), so it's qBittorrent that
 * didn't answer, not the service. It also starts the shared poll, which nothing may be running on
 * this screen: qBittorrent answers it 403 when its session has ended, and the poll's handler then
 * brings back qBittorrent's login, which Retry couldn't.
 */
export function StoreUnreadState({ onRetry, retryIcon }: StoreUnreadStateProps) {
  useMainData()
  return <UnreachableState unreachable="qbittorrent" onRetry={onRetry} texts="connect" retryIcon={retryIcon} />
}
