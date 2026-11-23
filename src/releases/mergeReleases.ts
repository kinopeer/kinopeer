import type { Release } from '../api/prowlarr'

const identity = (release: Release) => release.infoHash?.toLowerCase() || release.id

/**
 * The releases of several searches for one title as one list, in the order found: a release a later
 * search found again is left out, by its info hash, else Prowlarr's guid, which the indexer gives
 * and Prowlarr passes on as it is. Not by the download link: Prowlarr encrypts each search's links
 * afresh, so the same release comes with another one. What one search answered is kept as it is, so
 * a single search's list is Prowlarr's own.
 */
export function mergeReleases(lists: readonly Release[][]): Release[] {
  const merged: Release[] = []
  for (const list of lists) {
    const earlier = new Set(merged.map(identity))
    merged.push(...list.filter((release) => !earlier.has(identity(release))))
  }
  return merged
}
