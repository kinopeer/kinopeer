import { seedTorrent, waitForQbittorrent } from './qbittorrent.ts'

/** Before the journeys: qBittorrent answering, with the torrent Downloads shows. */
export default async function setup(): Promise<void> {
  await waitForQbittorrent()
  await seedTorrent()
}
