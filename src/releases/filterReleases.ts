import type { Release } from '../api/prowlarr'
import { usualOrder, type SortOrder, type UsualDirections } from '../logic/sortOrder'
import type { Audio, ReleaseInfo, Resolution, Source } from './parseRelease'

/**
 * The value of a filter for a release whose name doesn't state it: the parser reads every quality and
 * voice-over from the name, and much of what indexers name says neither. A value of its own rather
 * than one that passes every filter, so picking 1080p still means 1080p.
 */
export const NOT_STATED = 'none'
export type NotStated = typeof NOT_STATED
export type ResolutionFilter = Resolution | NotStated
export type SourceFilter = Source | NotStated
/** A voice-over, not stated (no voice-over in the name, subtitles or not), or subtitles. */
export type AudioFilter = Audio | NotStated | 'subs'
export type SortKey = 'seeds' | 'size' | 'date'

export interface Filters {
  resolution: ResolutionFilter[]
  audio: AudioFilter[]
  source: SourceFilter[]
  indexer: string[]
  minSeeds: number
}

/** The filters a search starts from, remembered from the last one: all but the indexer. */
export type RememberedFilters = Omit<Filters, 'indexer'>

export type Sort = SortOrder<SortKey>

/** A release with what its name says about it. */
export interface ReleaseRow {
  release: Release
  info: ReleaseInfo
}

/** The filter values the results have, in display order. */
export interface PresentValues {
  resolution: ResolutionFilter[]
  audio: AudioFilter[]
  source: SourceFilter[]
  indexer: string[]
}

export const NO_FILTERS: Filters = { resolution: [], audio: [], source: [], indexer: [], minSeeds: 0 }
const { indexer: _indexer, ...noRemembered } = NO_FILTERS
export const NO_REMEMBERED_FILTERS: RememberedFilters = noRemembered
/** Each sort's usual direction, the one a pick or a column's first click gives: most seeds, largest, newest. */
export const RELEASES_USUALLY_DESCENDING: UsualDirections<SortKey> = { seeds: true, size: true, date: true }
export const DEFAULT_SORT: Sort = usualOrder('seeds', RELEASES_USUALLY_DESCENDING)
export const RESOLUTIONS: ResolutionFilter[] = ['2160p', '1080p', '720p', 'SD', NOT_STATED]
export const AUDIO: AudioFilter[] = ['dub', 'mvo', 'avo2', 'avo1', 'orig', NOT_STATED, 'subs']
export const SOURCES: SourceFilter[] = ['REMUX', 'BluRay', 'BDRip', 'WEB-DL', 'WEBRip', 'HDRip', 'HDTV', 'DVD', 'CAM', NOT_STATED]
export const MIN_SEEDS = [0, 10, 50, 100]
export const SORT_KEYS: SortKey[] = ['seeds', 'size', 'date']

function hasAudio(info: ReleaseInfo, audio: AudioFilter): boolean {
  if (audio === 'subs') return info.subs
  if (audio === NOT_STATED) return info.audio.length === 0
  return info.audio.includes(audio)
}

const resolutionOf = (info: ReleaseInfo): ResolutionFilter => info.resolution ?? NOT_STATED
const sourceOf = (info: ReleaseInfo): SourceFilter => info.source ?? NOT_STATED

export function matchesFilters(row: ReleaseRow, filters: Filters): boolean {
  const { info, release } = row
  const has = <T>(list: T[], value: T | undefined) => value !== undefined && list.includes(value)
  return (
    (!filters.resolution.length || filters.resolution.includes(resolutionOf(info))) &&
    (!filters.source.length || filters.source.includes(sourceOf(info))) &&
    (!filters.indexer.length || has(filters.indexer, release.indexer)) &&
    (!filters.audio.length || filters.audio.some((audio) => hasAudio(info, audio))) &&
    (release.seeders ?? 0) >= filters.minSeeds
  )
}

function sortValue(row: ReleaseRow, key: SortKey): number {
  if (key === 'seeds') return row.release.seeders ?? 0
  if (key === 'size') return row.release.size
  return row.release.publishDate ? Date.parse(row.release.publishDate) : 0
}

/** The rows the filters let through, in the sort's order. */
export function filterReleases(rows: ReleaseRow[], filters: Filters, sort: Sort): ReleaseRow[] {
  const direction = sort.descending ? -1 : 1
  return rows
    .filter((row) => matchesFilters(row, filters))
    .sort((a, b) => (sortValue(a, sort.key) - sortValue(b, sort.key)) * direction)
}

/** Which filter values to offer: only those the results have. */
export function presentValues(rows: ReleaseRow[]): PresentValues {
  return {
    resolution: RESOLUTIONS.filter((value) => rows.some((row) => resolutionOf(row.info) === value)),
    source: SOURCES.filter((value) => rows.some((row) => sourceOf(row.info) === value)),
    audio: AUDIO.filter((value) => rows.some((row) => hasAudio(row.info, value))),
    indexer: [...new Set(rows.map((row) => row.release.indexer).filter(Boolean))].sort(),
  }
}

/** The order in which remembered filters give way when together they match no release. */
const GIVE_WAY: (keyof RememberedFilters)[] = ['minSeeds', 'source', 'audio', 'resolution']

/**
 * A search's filters at the start, from the remembered ones. A remembered value none of the
 * releases has is set aside: a usual 2160p doesn't hide every release of a title that has no 2160p,
 * and applies again on the next title that has some. If what's left matches no release together,
 * filters give way one at a time, the seeds first (so a minimum none of them reaches goes) and the
 * resolution last. The indexer always starts unpicked.
 */
export function startingFilters(remembered: RememberedFilters, rows: ReleaseRow[], present: PresentValues): Filters {
  const kept: Filters = {
    resolution: remembered.resolution.filter((value) => present.resolution.includes(value)),
    audio: remembered.audio.filter((value) => present.audio.includes(value)),
    source: remembered.source.filter((value) => present.source.includes(value)),
    indexer: [],
    minSeeds: remembered.minSeeds,
  }
  const matches = (filters: Filters) => rows.some((row) => matchesFilters(row, filters))
  let filters = kept
  const dropped: (keyof RememberedFilters)[] = []
  for (const key of GIVE_WAY) {
    if (matches(filters)) break
    filters = { ...filters, [key]: NO_REMEMBERED_FILTERS[key] }
    dropped.push(key)
  }
  // A filter dropped on the way may not have been in the way: put it back if releases still match.
  for (const key of dropped.reverse()) {
    const restored = { ...filters, [key]: kept[key] }
    if (matches(restored)) filters = restored
  }
  return filters
}

/**
 * The remembered filters after a change: the filters it sets, but not the indexer. A changed list
 * keeps the remembered values the search didn't apply (set aside), since they weren't on screen to
 * keep or take off, and a minimum of seeds set aside stays through a pick of Any.
 */
export function remember(remembered: RememberedFilters, change: Partial<Filters>, filters: Filters): RememberedFilters {
  const list = <T>(changed: T[] | undefined, kept: T[], shown: T[]) =>
    changed ? [...changed, ...kept.filter((value) => !shown.includes(value) && !changed.includes(value))] : kept
  return {
    resolution: list(change.resolution, remembered.resolution, filters.resolution),
    audio: list(change.audio, remembered.audio, filters.audio),
    source: list(change.source, remembered.source, filters.source),
    // Any picked while the remembered minimum was set aside (Any shown) changes nothing.
    minSeeds: change.minSeeds === undefined || (change.minSeeds === 0 && filters.minSeeds === 0) ? remembered.minSeeds : change.minSeeds,
  }
}

/**
 * The remembered filters split by whether the search's filters apply them: `aside` is what was set
 * aside, `applied` what's left once those are forgotten.
 */
export function split(remembered: RememberedFilters, filters: Filters): { applied: RememberedFilters; aside: RememberedFilters } {
  const part = <T>(values: T[], shown: T[], keep: boolean) => values.filter((value) => shown.includes(value) === keep)
  const seedsApplied = remembered.minSeeds === filters.minSeeds
  const side = (keep: boolean): RememberedFilters => ({
    resolution: part(remembered.resolution, filters.resolution, keep),
    audio: part(remembered.audio, filters.audio, keep),
    source: part(remembered.source, filters.source, keep),
    minSeeds: seedsApplied === keep ? remembered.minSeeds : 0,
  })
  return { applied: side(true), aside: side(false) }
}

/** Remembered filters as stored, with anything that isn't a value the filters offer dropped. */
export function knownReleaseFilters(stored: unknown): RememberedFilters {
  const value = (typeof stored === 'object' && stored) || {}
  const known = <T>(list: unknown, values: readonly T[]): T[] =>
    Array.isArray(list) ? values.filter((item) => list.includes(item)) : []
  const { resolution, audio, source, minSeeds } = value as Record<string, unknown>
  return {
    resolution: known(resolution, RESOLUTIONS),
    audio: known(audio, AUDIO),
    source: known(source, SOURCES),
    minSeeds: MIN_SEEDS.includes(minSeeds as number) ? (minSeeds as number) : 0,
  }
}

/** A stored sort if it's one the releases have, in its usual direction if stored without one, else the default. */
export function knownReleaseSort(stored: unknown): Sort {
  const sort = stored as Partial<Sort> | null | undefined
  if (!sort?.key || !SORT_KEYS.includes(sort.key)) return DEFAULT_SORT
  return typeof sort.descending === 'boolean'
    ? { key: sort.key, descending: sort.descending }
    : usualOrder(sort.key, RELEASES_USUALLY_DESCENDING)
}

export function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

/** A chip's label for several picked values: "1080p" or "1080p +2", else the filter's name. */
export function summary<T extends string>(values: T[], label: string, show: (value: T) => string = (value) => value): string {
  return values.length === 0 ? label : values.length === 1 ? show(values[0]) : `${show(values[0])} +${values.length - 1}`
}
