// How qBittorrent knows a torrent, for asking it whether it has one. qBittorrent knows a torrent by
// its ID, the v1 info hash, or for a v2-only torrent the v2 one truncated to 40 hex digits; its
// `hashes` filter takes that ID only, so a hybrid torrent, whose ID is its v1 hash, isn't found by
// its v2 hash.

/**
 * The ID qBittorrent knows a torrent by, for its info hash, lowercase: a v1 hash (40 hex digits) as
 * it is, a v2 one (64) truncated to 40. Undefined for anything else, no hash included.
 */
export function torrentId(infoHash: string | undefined): string | undefined {
  if (infoHash === undefined) return undefined
  const hash = infoHash.trim().toLowerCase()
  if (/^[0-9a-f]{40}$/.test(hash)) return hash
  if (/^[0-9a-f]{64}$/.test(hash)) return hash.slice(0, 40)
  return undefined
}

/**
 * The IDs among `ids` that qBittorrent's `torrents` have (a torrent's `hash` is its ID), for marking
 * what of a list is in downloads already. Empty without the torrents.
 */
export function heldIds(torrents: readonly { hash: string }[] | undefined, ids: ReadonlySet<string>): ReadonlySet<string> {
  return new Set(torrents?.flatMap(({ hash }) => (ids.has(hash) ? [hash] : [])))
}

/** Whether two sets of IDs hold the same ones. */
export const sameIds = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((id) => b.has(id))
