import { NOTIFY_TAG, type Torrent } from '../api/qbittorrent'

/** A torrent's tags, which qBittorrent lists as one string joined with ", ". */
function tagsOf(torrent: Pick<Torrent, 'tags'>): string[] {
  return (torrent.tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean)
}

/** Whether the torrent's notification is on: it has the tag Kinopeer's server watches for. */
export function notifies(torrent: Pick<Torrent, 'tags'>): boolean {
  return tagsOf(torrent).includes(NOTIFY_TAG)
}

/** The torrent as qBittorrent lists it once its notification is switched on or off. */
export function withNotify(torrent: Torrent, on: boolean): Torrent {
  const others = tagsOf(torrent).filter((tag) => tag !== NOTIFY_TAG)
  return { ...torrent, tags: (on ? [...others, NOTIFY_TAG] : others).sort().join(', ') }
}
