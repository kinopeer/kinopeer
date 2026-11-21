import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { failureOf, type ConnectionFailure } from '../api/connectionFailure'
import type { Torrent } from '../api/qbittorrent'
import { ProwlarrSetupError, getFailingIndexers, searchReleases, type Release } from '../api/prowlarr'
import { clickedOrder, cycledOrder, reversedOrder, usualOrder } from '../logic/sortOrder'
import { useRequest } from '../lib/useRequest'
import {
  NOT_STATED,
  NO_FILTERS,
  NO_REMEMBERED_FILTERS,
  RELEASES_USUALLY_DESCENDING,
  SORT_KEYS,
  filterReleases,
  presentValues,
  remember,
  split,
  startingFilters,
  toggle,
  type AudioFilter,
  type Filters,
  type PresentValues,
  type ReleaseRow,
  type RememberedFilters,
  type ResolutionFilter,
  type Sort,
  type SortKey,
  type SourceFilter,
} from '../releases/filterReleases'
import { parseRelease } from '../releases/parseRelease'
import { sourceName } from '../releases/qualityBadges'
import { releaseQuery, type TitleDetails } from '../releases/releaseQuery'
import { useSettings } from '../settings/settings'
import { heldIds, sameIds, torrentId } from '../torrents/sameTorrent'
import { useLastTorrents } from '../torrents/useMainData'

export const AUDIO_LABEL = {
  dub: 'releases.audioDub',
  mvo: 'releases.audioMvo',
  avo2: 'releases.audioAvo2',
  avo1: 'releases.audioAvo1',
  orig: 'releases.audioOrig',
  none: 'releases.audioNotStated',
  subs: 'releases.audioSubs',
} as const

export const SORT_LABEL = { seeds: 'fields.seeds', size: 'fields.size', date: 'fields.date' } as const

/** A picked filter value, shown as a removable chip. */
export interface ActiveFilter {
  key: string
  label: string
  /** The filters without this value. */
  remove: Partial<Filters>
}

/**
 * 'setup': the server has no address or key for Prowlarr; 'rejected': Prowlarr rejected the server's
 * key; 'error': Prowlarr or the server didn't answer, or something in front of the server answered
 * without its code (a proxy's error page on a long search).
 */
export type ReleasesStatus = 'loading' | 'setup' | 'rejected' | 'error' | 'none' | 'ready'

export interface Releases {
  status: ReleasesStatus
  /** With `error`: why Prowlarr didn't answer, where the server could tell (#508). */
  failure?: ConnectionFailure
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
  /** Remembered filters this search doesn't apply, because no release (or none together) meets them. */
  aside: RememberedFilters
  /** Forgets the remembered filters this search doesn't apply. */
  forgetAside: () => void
  sort: Sort
  /** A pick of a sort beside the list: that sort in its usual direction, the current one included. */
  pickSort: (key: SortKey) => void
  /** A click on a sort's column: the current sort reversed, another in its usual direction. */
  clickSort: (key: SortKey) => void
  /** The direction button: the same sort the other way. */
  reverseSort: () => void
  /** The phone's sort chip: the current sort the other way, then the next sort in its usual direction. */
  cycleSort: () => void
  /** Filter values as the screens show them: resolutions and sources as named, but Not stated. */
  resolutionLabel: (value: ResolutionFilter) => string
  audioLabel: (value: AudioFilter) => string
  sourceLabel: (value: SourceFilter) => string
  /**
   * A filter's label as an option in its own group, under the filter's name: Not stated says just
   * that there, while chips and notes outside the group need the filter's name in it.
   */
  optionLabel: <T extends string>(label: (value: T) => string) => (value: T) => string
  /**
   * The torrent qBittorrent has for a release, by the release's info hash: its hash, for opening it
   * in place of adding the release again. Undefined for a release it doesn't have, or one whose
   * indexer gives no hash.
   */
  inDownloads: (row: ReleaseRow) => string | undefined
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
  // No category filter: some indexers file every release under "Other".
  return { releases: await searchReleases(query, { signal }), started }
}

/**
 * Searches Prowlarr for the title's releases once `details` is known and `enabled`, and keeps the
 * filters, the sort and the release being added: what the phone's releases screen and the desktop
 * title page share. The filters start from the ones picked last (`startingFilters`), and a pick is
 * remembered for the next title; the sort is remembered as it is.
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

  const [settings, updateSettings] = useSettings()
  // Unset until the user changes a filter in this search; till then they follow the remembered ones.
  const [picked, setPicked] = useState<{ key: string | null; filters: Filters }>()
  const [adding, setAdding] = useState<ReleaseRow>()

  const rows = useMemo<ReleaseRow[]>(
    () => (search.data?.releases ?? []).map((release) => ({ release, info: parseRelease(release.title) })),
    [search.data],
  )
  // Prowlarr dates an indexer's last failure from any client's query (Sonarr, Radarr, its own tests),
  // so an indexer whose releases are in these results did answer this search.
  const missing = useMemo(() => {
    const answered = new Set(rows.map((row) => row.release.indexer))
    return (failing.data ?? []).filter((name) => !answered.has(name))
  }, [failing.data, rows])
  // Which releases qBittorrent has (#375), from the torrents the page has without starting the poll,
  // asked for once if it has none; worked out inside the subscription, so a poll that changes none
  // of them renders nothing. A hybrid torrent named by its v2 hash isn't found: qBittorrent knows it
  // by its v1 hash (sameTorrent.ts).
  const ids = useMemo(() => new Set(rows.flatMap((row) => torrentId(row.release.infoHash) ?? [])), [rows])
  const held = useLastTorrents(
    useCallback((torrents: Torrent[] | undefined) => heldIds(torrents, ids), [ids]),
    sameIds,
  )
  const present = useMemo(() => presentValues(rows), [rows])
  const { releaseFilters: remembered, releaseSort: sort } = settings
  // Picks from another search (another title) don't carry over.
  const own = picked?.key === key ? picked.filters : undefined
  // The starting filters are worked out only until the first pick, which every later pick builds on.
  const filters = useMemo(() => own ?? startingFilters(remembered, rows, present), [own, remembered, rows, present])
  const visible = useMemo(() => filterReleases(rows, filters, sort), [rows, filters, sort])
  const { applied, aside } = useMemo(() => split(remembered, filters), [remembered, filters])

  // Resolutions and sources show as named; Not stated says which filter, as AUDIO_LABEL.none does.
  const resolutionLabel = (value: ResolutionFilter) => (value === NOT_STATED ? t('releases.resolutionNotStated') : value)
  const audioLabel = (value: AudioFilter) => t(AUDIO_LABEL[value])
  const sourceLabel = (value: SourceFilter) => (value === NOT_STATED ? t('releases.sourceNotStated') : sourceName(t)(value))
  const optionLabel =
    <T extends string>(label: (value: T) => string) =>
    (value: T) =>
      value === NOT_STATED ? t('releases.notStated') : label(value)
  const active: ActiveFilter[] = [
    ...filters.resolution.map((value) => ({ key: `r-${value}`, label: resolutionLabel(value), remove: { resolution: toggle(filters.resolution, value) } })),
    ...filters.audio.map((value) => ({ key: `a-${value}`, label: audioLabel(value), remove: { audio: toggle(filters.audio, value) } })),
    ...filters.source.map((value) => ({ key: `s-${value}`, label: sourceLabel(value), remove: { source: toggle(filters.source, value) } })),
    ...filters.indexer.map((value) => ({ key: `i-${value}`, label: value, remove: { indexer: toggle(filters.indexer, value) } })),
    ...(filters.minSeeds
      ? [{ key: 'seeds', label: t('releases.seedsPlus', { count: filters.minSeeds }), remove: { minSeeds: 0 } }]
      : []),
  ]

  const status: ReleasesStatus =
    // One without the server's code is something in front of it failing (a proxy's error page on a
    // long search), not Prowlarr wanting a setup: it's an error to try again.
    search.error instanceof ProwlarrSetupError && search.error.code
      ? search.error.code === 'unauthorized'
        ? 'rejected'
        : 'setup'
      : search.error
        ? 'error'
        : !search.data
          ? 'loading'
          : rows.length
            ? 'ready'
            : 'none'

  return {
    status,
    failure: failureOf(search.error),
    retry: search.retry,
    failing: missing,
    rows,
    visible,
    present,
    filters,
    updateFilters: (change) => {
      setPicked({ key, filters: { ...filters, ...change } })
      // The indexer isn't remembered: a pick of it alone leaves the settings as they are.
      if (Object.keys(change).some((name) => name !== 'indexer')) {
        updateSettings({ releaseFilters: remember(remembered, change, filters) })
      }
    },
    clearFilters: () => {
      setPicked({ key, filters: NO_FILTERS })
      updateSettings({ releaseFilters: NO_REMEMBERED_FILTERS })
    },
    active,
    aside,
    forgetAside: () => updateSettings({ releaseFilters: applied }),
    sort,
    pickSort: (sortKey) => updateSettings({ releaseSort: usualOrder(sortKey, RELEASES_USUALLY_DESCENDING) }),
    clickSort: (sortKey) => updateSettings({ releaseSort: clickedOrder(sort, sortKey, RELEASES_USUALLY_DESCENDING) }),
    reverseSort: () => updateSettings({ releaseSort: reversedOrder(sort) }),
    cycleSort: () => updateSettings({ releaseSort: cycledOrder(sort, SORT_KEYS, RELEASES_USUALLY_DESCENDING) }),
    resolutionLabel,
    audioLabel,
    sourceLabel,
    optionLabel,
    inDownloads: (row) => {
      // No release without an ID is held: '' isn't one.
      const id = torrentId(row.release.infoHash) ?? ''
      return held.has(id) ? id : undefined
    },
    adding,
    setAdding,
  }
}
