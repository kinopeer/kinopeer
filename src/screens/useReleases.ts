import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ProwlarrSetupError, getFailingIndexers, searchReleases, type Release } from '../api/prowlarr'
import { useRequest } from '../lib/useRequest'
import {
  DEFAULT_SORT,
  NO_FILTERS,
  filterReleases,
  presentValues,
  toggle,
  type AudioFilter,
  type Filters,
  type PresentValues,
  type ReleaseRow,
  type Sort,
} from '../releases/filterReleases'
import { parseRelease } from '../releases/parseRelease'
import { releaseQuery, type TitleDetails } from '../releases/releaseQuery'

export const AUDIO_LABEL = {
  dub: 'releases.audioDub',
  mvo: 'releases.audioMvo',
  avo2: 'releases.audioAvo2',
  avo1: 'releases.audioAvo1',
  orig: 'releases.audioOrig',
  subs: 'releases.audioSubs',
} as const

export const SORT_LABEL = { seeds: 'releases.sortSeeds', size: 'releases.sortSize', date: 'releases.sortDate' } as const

/** A picked filter value, shown as a removable chip. */
export interface ActiveFilter {
  key: string
  label: string
  /** The filters without this value. */
  remove: Partial<Filters>
}

export type ReleasesStatus = 'loading' | 'setup' | 'error' | 'none' | 'ready'

export interface Releases {
  status: ReleasesStatus
  retry: () => void
  /** Names of the indexers that didn't answer this search, so their releases are missing. */
  failing: string[]
  /** Every release found. */
  rows: ReleaseRow[]
  /** The releases the filters let through, sorted. */
  visible: ReleaseRow[]
  present: PresentValues
  filters: Filters
  updateFilters: (change: Partial<Filters>) => void
  clearFilters: () => void
  active: ActiveFilter[]
  sort: Sort
  setSort: (sort: Sort) => void
  audioLabel: (value: AudioFilter) => string
  /** The release whose add sheet is open. */
  adding?: ReleaseRow
  setAdding: (row: ReleaseRow | undefined) => void
}

interface Found {
  releases: Release[]
  /** performance.now() when the search started. */
  started: number
}

async function find(query: string, signal: AbortSignal): Promise<Found> {
  const started = performance.now()
  // No category filter: some indexers (RuTor) file every release under "Other".
  return { releases: await searchReleases(query, { signal }), started }
}

/**
 * Searches Prowlarr for the title's releases once `details` is known and `enabled`, and keeps the
 * filters, the sort and the release being added: what the phone's releases screen and the desktop
 * title page share.
 */
export function useReleases(details: TitleDetails | undefined, enabled = true): Releases {
  const { t } = useTranslation()
  const query = details && enabled ? releaseQuery(details) : null
  const key = query ? `${details!.type}|${query}` : null
  const search = useRequest<Found>(key, (signal) => find(query!, signal))
  // Prowlarr answers with what the working indexers found and says nothing about the rest, so once
  // the search answers, ask which failed since it started. The releases don't wait for it, and
  // without an answer there's just no note.
  const started = search.data?.started
  const failing = useRequest<string[]>(started === undefined ? null : `${key}|${started}`, (signal) =>
    getFailingIndexers(performance.now() - started!, signal),
  )

  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT)
  const [adding, setAdding] = useState<ReleaseRow>()

  const rows = useMemo<ReleaseRow[]>(
    () => (search.data?.releases ?? []).map((release) => ({ release, info: parseRelease(release.title) })),
    [search.data],
  )
  const visible = useMemo(() => filterReleases(rows, filters, sort), [rows, filters, sort])
  const present = useMemo(() => presentValues(rows), [rows])

  const audioLabel = (value: AudioFilter) => t(AUDIO_LABEL[value])
  const active: ActiveFilter[] = [
    ...filters.resolution.map((value) => ({ key: `r-${value}`, label: value, remove: { resolution: toggle(filters.resolution, value) } })),
    ...filters.audio.map((value) => ({ key: `a-${value}`, label: audioLabel(value), remove: { audio: toggle(filters.audio, value) } })),
    ...filters.source.map((value) => ({ key: `s-${value}`, label: value, remove: { source: toggle(filters.source, value) } })),
    ...filters.indexer.map((value) => ({ key: `i-${value}`, label: value, remove: { indexer: toggle(filters.indexer, value) } })),
    ...(filters.minSeeds
      ? [{ key: 'seeds', label: t('releases.seedsPlus', { count: filters.minSeeds }), remove: { minSeeds: 0 } }]
      : []),
  ]

  const status: ReleasesStatus =
    search.error instanceof ProwlarrSetupError
      ? 'setup'
      : search.error
        ? 'error'
        : !search.data
          ? 'loading'
          : rows.length
            ? 'ready'
            : 'none'

  return {
    status,
    retry: search.retry,
    failing: failing.data ?? [],
    rows,
    visible,
    present,
    filters,
    updateFilters: (change) => setFilters({ ...filters, ...change }),
    clearFilters: () => setFilters(NO_FILTERS),
    active,
    sort,
    setSort,
    audioLabel,
    adding,
    setAdding,
  }
}
