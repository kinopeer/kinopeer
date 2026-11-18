// Whether qBittorrent already has a torrent, by its info hash. qBittorrent knows a torrent by its ID,
// the v1 info hash, or for a v2-only torrent the v2 one truncated to 40 hex digits; its `hashes`
// filter takes that ID only, so a hybrid torrent, whose ID is its v1 hash, isn't found by its v2 hash.

/**
 * The ID qBittorrent knows a torrent by, for its info hash, lowercase: a v1 hash (40 hex digits) as
 * it is, a v2 one (64) truncated to 40. Undefined for anything else.
 */
export function torrentId(infoHash: string): string | undefined {
  const hash = infoHash.trim().toLowerCase()
  if (/^[0-9a-f]{40}$/.test(hash)) return hash
  if (/^[0-9a-f]{64}$/.test(hash)) return hash.slice(0, 40)
  return undefined
}

/** The torrent among these with this info hash, by qBittorrent's ID. */
export function findByHash<T extends { hash: string }>(torrents: readonly T[], infoHash: string): T | undefined {
  const id = torrentId(infoHash)
  if (id === undefined) return undefined
  return torrents.find((torrent) => torrent.hash === id)
}
