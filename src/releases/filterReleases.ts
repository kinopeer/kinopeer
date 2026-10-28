import type { Release } from '../api/prowlarr'
import type { Audio, ReleaseInfo, Resolution, Source } from './parseRelease'

export type AudioFilter = Audio | 'subs'
export type SortKey = 'seeds' | 'size' | 'date'

export interface Filters {
  resolution: Resolution[]
  audio: AudioFilter[]
  source: Source[]
  indexer: string[]
  minSeeds: number
}

/** The filters a search starts from, remembered from the last one: all but the indexer. */
export type RememberedFilters = Omit<Filters, 'indexer'>

export interface Sort {
  key: SortKey
  descending: boolean
}

/** A release with what its name says about it. */
export interface ReleaseRow {
  release: Release
  info: ReleaseInfo
}

/** The filter values the results have, in display order. */
export interface PresentValues {
  resolution: Resolution[]
  audio: AudioFilter[]
  source: Source[]
  indexer: string[]
}

export const NO_FILTERS: Filters = { resolution: [], audio: [], source: [], indexer: [], minSeeds: 0 }
export const NO_REMEMBERED_FILTERS: RememberedFilters = { resolution: [], audio: [], source: [], minSeeds: 0 }
export const DEFAULT_SORT: Sort = { key: 'seeds', descending: true }
export const RESOLUTIONS: Resolution[] = ['2160p', '1080p', '720p', 'SD']
export const AUDIO: AudioFilter[] = ['dub', 'mvo', 'avo2', 'avo1', 'orig', 'subs']
export const SOURCES: Source[] = ['REMUX', 'BluRay', 'BDRip', 'WEB-DL', 'WEBRip', 'HDRip', 'HDTV', 'DVD']
export const MIN_SEEDS = [0, 10, 50, 100]
export const SORT_KEYS: SortKey[] = ['seeds', 'size', 'date']

function hasAudio(info: ReleaseInfo, audio: AudioFilter): boolean {
  return audio === 'subs' ? info.subs : info.audio.includes(audio)
}

export function matchesFilters(row: ReleaseRow, filters: Filters): boolean {
  const { info, release } = row
  const has = <T>(list: T[], value: T | undefined) => value !== undefined && list.includes(value)
  return (
    (!filters.resolution.length || has(filters.resolution, info.resolution)) &&
    (!filters.source.length || has(filters.source, info.source)) &&
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
    resolution: RESOLUTIONS.filter((value) => rows.some((row) => row.info.resolution === value)),
    source: SOURCES.filter((value) => rows.some((row) => row.info.source === value)),
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
  const filters: Filters = {
    resolution: remembered.resolution.filter((value) => present.resolution.includes(value)),
    audio: remembered.audio.filter((value) => present.audio.includes(value)),
    source: remembered.source.filter((value) => present.source.includes(value)),
    indexer: [],
    minSeeds: remembered.minSeeds,
  }
  for (const key of GIVE_WAY) {
    if (rows.some((row) => matchesFilters(row, filters))) break
    Object.assign(filters, { [key]: NO_REMEMBERED_FILTERS[key] })
  }
  return filters
}

/**
 * The remembered filters after a change: the filters it sets, but not the indexer. A changed list
 * keeps the remembered values these releases don't have, since they weren't offered to keep.
 */
export function remember(remembered: RememberedFilters, change: Partial<Filters>, present: PresentValues): RememberedFilters {
  const list = <T>(changed: T[] | undefined, kept: T[], offered: T[]) =>
    changed ? [...changed, ...kept.filter((value) => !offered.includes(value) && !changed.includes(value))] : kept
  return {
    resolution: list(change.resolution, remembered.resolution, present.resolution),
    audio: list(change.audio, remembered.audio, present.audio),
    source: list(change.source, remembered.source, present.source),
    minSeeds: change.minSeeds ?? remembered.minSeeds,
  }
}

/** The remembered filters the search's filters don't apply: those set aside, or a different seeds minimum. */
export function setAside(remembered: RememberedFilters, filters: Filters): RememberedFilters {
  return {
    resolution: remembered.resolution.filter((value) => !filters.resolution.includes(value)),
    audio: remembered.audio.filter((value) => !filters.audio.includes(value)),
    source: remembered.source.filter((value) => !filters.source.includes(value)),
    minSeeds: remembered.minSeeds !== filters.minSeeds ? remembered.minSeeds : 0,
  }
}

/** The remembered filters the search's filters apply: what's left once those set aside are forgotten. */
export function applied(remembered: RememberedFilters, filters: Filters): RememberedFilters {
  return {
    resolution: remembered.resolution.filter((value) => filters.resolution.includes(value)),
    audio: remembered.audio.filter((value) => filters.audio.includes(value)),
    source: remembered.source.filter((value) => filters.source.includes(value)),
    minSeeds: remembered.minSeeds === filters.minSeeds ? remembered.minSeeds : 0,
  }
}

/** Remembered filters as stored, with anything that isn't a known value dropped. */
export function knownReleaseFilters(stored: unknown): RememberedFilters {
  const value = (typeof stored === 'object' && stored) || {}
  const known = <T>(list: unknown, values: readonly T[]): T[] =>
    Array.isArray(list) ? values.filter((item) => list.includes(item)) : []
  const { resolution, audio, source, minSeeds } = value as Record<string, unknown>
  return {
    resolution: known(resolution, RESOLUTIONS),
    audio: known(audio, AUDIO),
    source: known(source, SOURCES),
    minSeeds: typeof minSeeds === 'number' && Number.isFinite(minSeeds) && minSeeds > 0 ? minSeeds : 0,
  }
}

/** A stored sort if it's one the releases have, else the default. */
export function knownReleaseSort(sort: Partial<Sort> | undefined): Sort {
  return sort?.key && SORT_KEYS.includes(sort.key) ? { key: sort.key, descending: sort.descending ?? true } : DEFAULT_SORT
}

export function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

/** A chip's label for several picked values: "1080p" or "1080p +2", else the filter's name. */
export function summary<T extends string>(values: T[], label: string, show: (value: T) => string = (value) => value): string {
  return values.length === 0 ? label : values.length === 1 ? show(values[0]) : `${show(values[0])} +${values.length - 1}`
}
