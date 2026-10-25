import { useParams } from 'react-router'
import { TorrentDetails } from './TorrentDetails'

export interface TorrentScreenProps {
  /** qBittorrent rejected the session cookie (expired or signed out elsewhere). */
  onSessionLost: () => void
}

/** `/torrent/:hash` on a phone or tablet: the torrent's details as a screen of their own. */
export function TorrentScreen({ onSessionLost }: TorrentScreenProps) {
  const { hash = '' } = useParams()
  return <TorrentDetails hash={hash} onSessionLost={onSessionLost} />
}
