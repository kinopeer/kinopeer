import type { Release } from '../api/prowlarr'

/**
 * The releases of several searches for one title as one list, in the order found, a release that
 * more than one search found kept once, as the first one found it: by its info hash, else its
 * download link, else Prowlarr's guid (a hash and a link never read as each other: a link has a
 * slash).
 */
export function mergeReleases(lists: readonly Release[][]): Release[] {
  const seen = new Set<string>()
  return lists.flat().filter((release) => {
    const key = release.infoHash?.toLowerCase() ?? release.download ?? release.id
    return !seen.has(key) && !!seen.add(key)
  })
}
