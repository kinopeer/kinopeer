import type { TorrentTracker } from '../api/qbittorrent'

/** Host names of the real trackers, without DHT, PeX and LSD. */
export function trackerHosts(trackers: TorrentTracker[]): string[] {
  const hosts = trackers
    .filter((tracker) => !tracker.url.startsWith('** ['))
    .map((tracker) => {
      try {
        return new URL(tracker.url).hostname
      } catch {
        return tracker.url
      }
    })
  return [...new Set(hosts)]
}
