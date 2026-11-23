import type { Torrent } from '../api/qbittorrent'
import { usualOrder, type SortOrder, type UsualDirections } from '../logic/sortOrder'

/** Orders for the torrents to free space from: what's on disk, when it was added, its ratio. */
export const FREE_UP_SORTS = ['size', 'added', 'ratio'] as const
export type FreeUpSort = (typeof FREE_UP_SORTS)[number]
export type FreeUpOrder = SortOrder<FreeUpSort>

/** Each sort's usual direction: the largest, the oldest, the most shared first, what's best to delete first. */
export const FREE_UP_USUALLY_DESCENDING: UsualDirections<FreeUpSort> = {
  size: true,
  added: false,
  ratio: true,
}

/** The order the list starts from: largest on disk first. */
export const DEFAULT_FREE_UP_ORDER: FreeUpOrder = usualOrder('size', FREE_UP_USUALLY_DESCENDING)

/** A stored sort and direction, checked: one no longer offered, or stored without a direction, takes the default's or its usual direction. */
export function knownFreeUpOrder(sort: unknown, descending: unknown): FreeUpOrder {
  if (!FREE_UP_SORTS.includes(sort as FreeUpSort)) return DEFAULT_FREE_UP_ORDER
  const key = sort as FreeUpSort
  return typeof descending === 'boolean' ? { key, descending } : usualOrder(key, FREE_UP_USUALLY_DESCENDING)
}

/**
 * What a torrent takes on disk, as far as qBittorrent says: the part of its selected files it has.
 * Files it preallocates, and pieces of skipped files it keeps at their edges, aren't counted.
 */
export function onDisk(torrent: Pick<Torrent, 'size' | 'progress'>): number {
  return Math.max(0, Math.round(torrent.size * torrent.progress))
}

/** A path as compared: Windows' separators as `/`, without a trailing one. */
function normalized(path: string): string {
  const slashed = path.trim().replace(/\\/g, '/')
  return slashed.length > 1 ? slashed.replace(/\/+$/, '') : slashed
}

/**
 * Whether `path` is `base` or under it, by its text: qBittorrent reports where a torrent is, not
 * which disk that is. Letters' case counts, as on Linux, where qBittorrent mostly runs.
 */
export function isUnder(path: string, base: string): boolean {
  const folder = normalized(path)
  const root = normalized(base)
  if (!root) return false
  return folder === root || folder.startsWith(root.endsWith('/') ? root : `${root}/`)
}

/** The torrents split by whether qBittorrent's free space is likely theirs. */
export interface FreeUpGroups {
  /** Saved in the default save path or under it, on the disk qBittorrent reports the free space of. */
  counted: Torrent[]
  /** Saved elsewhere, which may be another disk: deleting them may free nothing there. */
  elsewhere: Torrent[]
}

/**
 * The torrents to free space from, each group in `order`, ties by name. qBittorrent reports free
 * space only for its default save path (`free_space_on_disk`), so a torrent counts toward it only
 * when it's saved there or under it. It misreads a disk mounted under the default save path, and
 * another path that leads to the same disk: such a torrent lands in the wrong group, which says
 * nothing wrong about the space, only leaves it out of the count or puts it in.
 */
export function groupForFreeUp(torrents: readonly Torrent[], defaultSavePath: string, order: FreeUpOrder): FreeUpGroups {
  const sorted = [...torrents].sort(compareForFreeUp(order))
  const counted: Torrent[] = []
  const elsewhere: Torrent[] = []
  for (const torrent of sorted) (isUnder(torrent.save_path, defaultSavePath) ? counted : elsewhere).push(torrent)
  return { counted, elsewhere }
}

function compareForFreeUp(order: FreeUpOrder): (a: Torrent, b: Torrent) => number {
  const value = (torrent: Torrent) =>
    order.key === 'size' ? onDisk(torrent) : order.key === 'added' ? torrent.added_on : torrent.ratio
  const direction = order.descending ? -1 : 1
  return (a, b) =>
    direction * (value(a) - value(b)) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * What deleting `torrents` frees where qBittorrent's free space counts it: what those saved in the
 * default save path or under it have on disk. Nothing while the default save path isn't known.
 */
export function countedSpace(torrents: readonly Torrent[], defaultSavePath: string | undefined): number {
  return torrents.reduce(
    (sum, torrent) => (defaultSavePath !== undefined && isUnder(torrent.save_path, defaultSavePath) ? sum + onDisk(torrent) : sum),
    0,
  )
}

/**
 * Space freed by deletes qBittorrent hasn't measured yet: it checks the free space on its own timer,
 * every 30 seconds, so a poll right after a delete still reports the figure from before. Held
 * against the figure it was freed from (`reported`), until qBittorrent reports another.
 */
export interface FreedSpace {
  reported: number
  freed: number
}

/**
 * The freed space after a delete of `freed` bytes where it counts, while qBittorrent reports
 * `reported`: added to what's held while the figure is the same, else held from the new figure.
 * Nothing is held when qBittorrent can't tell the free space.
 */
export function withFreed(held: FreedSpace | undefined, reported: number | undefined, freed: number): FreedSpace | undefined {
  if (reported === undefined) return undefined
  const kept = held?.reported === reported ? held.freed : 0
  return kept + freed > 0 ? { reported, freed: kept + freed } : undefined
}

/** The free space to show: qBittorrent's figure, plus what's held for it as an estimate until it reports another. */
export function estimatedFreeSpace(
  held: FreedSpace | undefined,
  reported: number | undefined,
): { free: number | undefined; estimate: boolean } {
  if (reported !== undefined && held?.reported === reported) return { free: reported + held.freed, estimate: true }
  return { free: reported, estimate: false }
}
