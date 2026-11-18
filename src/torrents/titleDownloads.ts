import type { Matches } from '../api/matches'
import type { Torrent } from '../api/qbittorrent'
import type { MediaType } from '../api/tmdb'
import { wholePercent } from '../logic/wholePercent'
import { lookupFor, type TitleMatch } from './titleLookup'

/** What a title's "In downloads" mark says: one torrent's progress, or how many there are. */
export type DownloadsMark = { progress: number } | { count: number }

/** The mark for a title's torrents: none without any, the progress of one, the count of several. */
export function downloadsMark(torrents: readonly Pick<Torrent, 'progress'>[]): DownloadsMark | undefined {
  if (torrents.length === 0) return undefined
  return torrents.length === 1 ? { progress: torrents[0].progress } : { count: torrents.length }
}

/** The key `torrentsByTitle` files a title's torrents under. */
export const titleKey = (type: MediaType, id: number) => `${type}:${id}`

/**
 * The torrents of each title whose torrents are known without asking TMDB, by `titleKey`: the
 * user's choice, the `tmdb:` tag, a guess the server keeps, else a guess this browser cached
 * (`cached`, by the lookup's key). A torrent nobody has guessed yet counts for no title.
 */
export function torrentsByTitle<T extends Pick<Torrent, 'hash' | 'name' | 'tags'> & { category?: string }>(
  torrents: readonly T[],
  server: Matches,
  cached: (key: string) => TitleMatch | null | undefined,
): Map<string, T[]> {
  const byTitle = new Map<string, T[]>()
  for (const torrent of torrents) {
    const lookup = lookupFor(torrent, server[torrent.hash])
    const title = lookup.tag ?? cached(lookup.key)
    if (!title) continue
    const key = titleKey(title.type, title.id)
    const list = byTitle.get(key)
    if (list) list.push(torrent)
    else byTitle.set(key, [torrent])
  }
  return byTitle
}

/** The mark of each title in `byTitle`, under the same key. */
export function marksByTitle(byTitle: ReadonlyMap<string, readonly Pick<Torrent, 'progress'>[]>): Map<string, DownloadsMark> {
  const marks = new Map<string, DownloadsMark>()
  for (const [key, torrents] of byTitle) {
    const mark = downloadsMark(torrents)
    if (mark) marks.set(key, mark)
  }
  return marks
}

/**
 * Whether two sets of marks show the same: the same titles, each with the same count, or the same
 * whole percent, which is all a mark shows of the progress (`wholePercent`, as `format.percent`).
 */
export function sameMarks(a: ReadonlyMap<string, DownloadsMark>, b: ReadonlyMap<string, DownloadsMark>): boolean {
  if (a.size !== b.size) return false
  for (const [key, mark] of a) {
    const other = b.get(key)
    if (!other) return false
    if ('count' in mark ? !('count' in other) || other.count !== mark.count : !('progress' in other) || wholePercent(other.progress) !== wholePercent(mark.progress)) return false
  }
  return true
}
