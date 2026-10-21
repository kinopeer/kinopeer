import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useParams } from 'react-router'
import {
  MOVIE_CATEGORY,
  ProwlarrSetupError,
  TV_CATEGORY,
  searchReleases,
  type Release,
} from '../api/prowlarr'
import { TmdbError, getMovie, getTv, tmdbLanguage } from '../api/tmdb'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { FilterChip } from '../components/FilterChip'
import { Icon } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { Segmented } from '../components/Segmented'
import { Sheet } from '../components/Sheet'
import { useFormatters } from '../lib/format'
import { useRequest } from '../lib/useRequest'
import {
  parseRelease,
  seasonCoverage,
  type Audio,
  type ReleaseInfo,
  type Resolution,
  type Source,
} from '../releases/parseRelease'
import { releaseQuery, type TitleDetails as Details } from '../releases/releaseQuery'
import './ReleasesScreen.css'

type AudioFilter = Audio | 'subs'
type SortKey = 'seeds' | 'size' | 'date'

interface Filters {
  resolution: Resolution[]
  audio: AudioFilter[]
  source: Source[]
  indexer: string[]
  minSeeds: number
}

interface Row {
  release: Release
  info: ReleaseInfo
}

const NO_FILTERS: Filters = { resolution: [], audio: [], source: [], indexer: [], minSeeds: 0 }
const RESOLUTIONS: Resolution[] = ['2160p', '1080p', '720p', 'SD']
const AUDIO: AudioFilter[] = ['dub', 'mvo', 'avo2', 'avo1', 'orig', 'subs']
const SOURCES: Source[] = ['REMUX', 'BluRay', 'BDRip', 'WEB-DL', 'WEBRip', 'HDTV', 'DVD']
const MIN_SEEDS = [0, 10, 50, 100]
const SORT_KEYS: SortKey[] = ['seeds', 'size', 'date']

const AUDIO_LABEL = {
  dub: 'releases.audioDub',
  mvo: 'releases.audioMvo',
  avo2: 'releases.audioAvo2',
  avo1: 'releases.audioAvo1',
  orig: 'releases.audioOrig',
  subs: 'releases.audioSubs',
} as const

const SORT_LABEL = { seeds: 'releases.sortSeeds', size: 'releases.sortSize', date: 'releases.sortDate' } as const

function matches(row: Row, filters: Filters): boolean {
  const { info, release } = row
  const has = <T,>(list: T[], value: T | undefined) => value !== undefined && list.includes(value)
  return (
    (!filters.resolution.length || has(filters.resolution, info.resolution)) &&
    (!filters.source.length || has(filters.source, info.source)) &&
    (!filters.indexer.length || has(filters.indexer, release.indexer)) &&
    (!filters.audio.length ||
      filters.audio.some((audio) => (audio === 'subs' ? info.subs : info.audio.includes(audio)))) &&
    (release.seeders ?? 0) >= filters.minSeeds
  )
}

function sortValue(row: Row, key: SortKey): number {
  if (key === 'seeds') return row.release.seeders ?? 0
  if (key === 'size') return row.release.size
  return row.release.publishDate ? Date.parse(row.release.publishDate) : 0
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

export function ReleasesScreen() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams()
  const type = params.type === 'movie' || params.type === 'tv' ? params.type : undefined
  const id = Number(params.id)
  const valid = type !== undefined && Number.isInteger(id) && id > 0
  const language = tmdbLanguage(i18n.resolvedLanguage ?? i18n.language)

  const details = useRequest<Details>(valid ? `${type}|${id}|${language}` : null, async (signal) =>
    type === 'movie'
      ? { type, ...(await getMovie(id, { language, signal })) }
      : { type: 'tv', ...(await getTv(id, { language, signal })) },
  )
  const query = details.data ? releaseQuery(details.data) : null
  const search = useRequest<Release[]>(query ? `${type}|${query}` : null, (signal) =>
    searchReleases(query!, { categories: [type === 'tv' ? TV_CATEGORY : MOVIE_CATEGORY], signal }),
  )

  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'seeds', descending: true })
  const [sheetOpen, setSheetOpen] = useState(false)

  const rows = useMemo<Row[]>(
    () => (search.data ?? []).map((release) => ({ release, info: parseRelease(release.title) })),
    [search.data],
  )
  const visible = useMemo(() => {
    const direction = sort.descending ? -1 : 1
    return rows
      .filter((row) => matches(row, filters))
      .sort((a, b) => (sortValue(a, sort.key) - sortValue(b, sort.key)) * direction)
  }, [rows, filters, sort])

  // Only offer values the results have, plus whatever is already selected.
  const present = useMemo(
    () => ({
      resolution: RESOLUTIONS.filter((value) => rows.some((row) => row.info.resolution === value)),
      source: SOURCES.filter((value) => rows.some((row) => row.info.source === value)),
      audio: AUDIO.filter((value) =>
        rows.some((row) => (value === 'subs' ? row.info.subs : row.info.audio.includes(value))),
      ),
      indexer: [...new Set(rows.map((row) => row.release.indexer).filter(Boolean))].sort(),
    }),
    [rows],
  )

  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate(`/title/${type}/${id}`))
  const audioLabel = (value: AudioFilter) => t(AUDIO_LABEL[value])
  const name = details.data ? (details.data.type === 'movie' ? details.data.title : details.data.name) : ''
  const year =
    details.data &&
    (details.data.type === 'movie' ? details.data.release_date : details.data.first_air_date)?.slice(0, 4)

  const active = [
    ...filters.resolution.map((value) => ({ key: `r-${value}`, label: value, remove: { resolution: toggle(filters.resolution, value) } })),
    ...filters.audio.map((value) => ({ key: `a-${value}`, label: audioLabel(value), remove: { audio: toggle(filters.audio, value) } })),
    ...filters.source.map((value) => ({ key: `s-${value}`, label: value, remove: { source: toggle(filters.source, value) } })),
    ...filters.indexer.map((value) => ({ key: `i-${value}`, label: value, remove: { indexer: toggle(filters.indexer, value) } })),
    ...(filters.minSeeds
      ? [{ key: 'seeds', label: t('releases.seedsPlus', { count: filters.minSeeds }), remove: { minSeeds: 0 } }]
      : []),
  ]
  const summary = <T extends string>(values: T[], label: string, show: (value: T) => string = (value) => value) =>
    values.length === 0 ? label : values.length === 1 ? show(values[0]) : `${show(values[0])} +${values.length - 1}`

  const error = details.error ?? search.error
  const notFound = !valid || (details.error instanceof TmdbError && details.error.status === 404)
  const loading = !error && (details.loading || search.loading || (!!query && !search.data))
  const retry = details.error ? details.retry : search.retry

  let body
  if (notFound) {
    body = (
      <EmptyState icon="film" tone="muted" title={t('title.notFoundTitle')} actionLabel={t('title.backToSearch')} onAction={() => navigate('/search')}>
        {t('title.notFoundBody')}
      </EmptyState>
    )
  } else if (error instanceof ProwlarrSetupError) {
    body = (
      <EmptyState icon="key" tone="error" title={t('releases.setupTitle')}>
        {t('releases.setupBody')}
      </EmptyState>
    )
  } else if (error) {
    body = (
      <EmptyState icon="wifi-off" tone="error" title={t('releases.errorTitle')} actionLabel={t('common.retry')} actionIcon="refresh" onAction={retry}>
        {t('releases.errorBody')}
      </EmptyState>
    )
  } else if (loading) {
    body = (
      <div className="rel-list" role="status">
        <span className="sr-only">{t('releases.loading')}</span>
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="ks-rel" aria-hidden="true">
            <div className="ks-skel" style={{ height: 16, width: '90%' }} />
            <div className="ks-skel" style={{ height: 16, width: '60%' }} />
            <div className="ks-skel" style={{ height: 22, width: '40%' }} />
          </div>
        ))}
      </div>
    )
  } else if (!rows.length) {
    body = (
      <EmptyState icon="folder" tone="muted" title={t('releases.noneTitle')} actionLabel={t('common.retry')} actionIcon="refresh" onAction={search.retry}>
        {t('releases.noneBody')}
      </EmptyState>
    )
  } else {
    body = (
      <>
        {active.length > 0 && (
          <div className="rel-active">
            {active.map((filter) => (
              <FilterChip
                key={filter.key}
                selected
                trailingIcon="close"
                aria-label={t('releases.removeFilter', { label: filter.label })}
                onClick={() => setFilters({ ...filters, ...filter.remove })}
              >
                {filter.label}
              </FilterChip>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setFilters(NO_FILTERS)}>
              {t('releases.clearAll')}
            </Button>
          </div>
        )}
        {visible.length > 0 ? (
          <>
            <p className="t-cap c3 ks-num rel-count" aria-live="polite">
              {t('releases.count', { shown: visible.length, count: rows.length })}
            </p>
            <ul className="rel-list">
              {visible.map((row) => (
                <li key={row.release.id}>
                  <ReleaseCard row={row} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState icon="filter" tone="muted" title={t('releases.noMatchTitle')} actionLabel={t('releases.resetFilters')} onAction={() => setFilters(NO_FILTERS)}>
            {t('releases.noMatchBody')}
          </EmptyState>
        )}
      </>
    )
  }

  const ready = rows.length > 0 && !error && !loading

  return (
    <main className="rel">
      <header className="rel-head">
        <div className="rel-bar">
          <IconButton icon="chevron-left" label={t('title.back')} iconSize={24} onClick={goBack} />
          <div className="rel-heading">
            <h1 className="t-h3">{t('releases.title')}</h1>
            {name && <p className="t-cap c3 ks-trunc">{[name, year].filter(Boolean).join(' · ')}</p>}
          </div>
        </div>
        {ready && (
          <div className="rel-chips ks-hscroll">
            <FilterChip solid icon="filter" selected={active.length > 0} count={active.length || undefined} onClick={() => setSheetOpen(true)}>
              {t('releases.filters')}
            </FilterChip>
            <FilterChip selected={filters.resolution.length > 0} trailingIcon="chevron-down" onClick={() => setSheetOpen(true)}>
              {summary(filters.resolution, t('releases.resolution'))}
            </FilterChip>
            <FilterChip selected={filters.audio.length > 0} trailingIcon="chevron-down" onClick={() => setSheetOpen(true)}>
              {summary(filters.audio, t('releases.audio'), audioLabel)}
            </FilterChip>
            <FilterChip selected={filters.source.length > 0} trailingIcon="chevron-down" onClick={() => setSheetOpen(true)}>
              {summary(filters.source, t('releases.source'))}
            </FilterChip>
            <FilterChip
              icon="sort"
              aria-label={`${t('releases.sort')}: ${t(SORT_LABEL[sort.key])}, ${t(sort.descending ? 'releases.descending' : 'releases.ascending')}`}
              onClick={() => setSort({ ...sort, key: SORT_KEYS[(SORT_KEYS.indexOf(sort.key) + 1) % SORT_KEYS.length] })}
            >
              {t(SORT_LABEL[sort.key])} {sort.descending ? '↓' : '↑'}
            </FilterChip>
          </div>
        )}
      </header>

      <section className="rel-body" aria-busy={loading}>
        {body}
      </section>

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={t('releases.filters')}
        action={
          <Button variant="ghost" size="sm" disabled={!active.length} onClick={() => setFilters(NO_FILTERS)}>
            {t('releases.reset')}
          </Button>
        }
        footer={
          <Button size="lg" block onClick={() => setSheetOpen(false)}>
            {t('releases.show', { count: visible.length })}
          </Button>
        }
      >
        <div className="rel-filters">
          <OptionGroup
            label={t('releases.resolution')}
            options={[...new Set([...present.resolution, ...filters.resolution])]}
            selected={filters.resolution}
            onToggle={(value) => setFilters({ ...filters, resolution: toggle(filters.resolution, value) })}
          />
          <OptionGroup
            label={t('releases.audio')}
            options={[...new Set([...present.audio, ...filters.audio])]}
            selected={filters.audio}
            show={audioLabel}
            onToggle={(value) => setFilters({ ...filters, audio: toggle(filters.audio, value) })}
          />
          <OptionGroup
            label={t('releases.source')}
            options={[...new Set([...present.source, ...filters.source])]}
            selected={filters.source}
            onToggle={(value) => setFilters({ ...filters, source: toggle(filters.source, value) })}
          />
          <div className="rel-group" role="group" aria-label={t('releases.minSeeds')}>
            <span className="ks-label">{t('releases.minSeeds')}</span>
            <div className="rel-options">
              {MIN_SEEDS.map((value) => (
                <FilterChip key={value} selected={filters.minSeeds === value} onClick={() => setFilters({ ...filters, minSeeds: value })}>
                  {value ? `${value}+` : t('releases.any')}
                </FilterChip>
              ))}
            </div>
          </div>
          {present.indexer.length > 1 && (
            <OptionGroup
              label={t('releases.indexer')}
              options={present.indexer}
              selected={filters.indexer}
              onToggle={(value) => setFilters({ ...filters, indexer: toggle(filters.indexer, value) })}
            />
          )}
          <div className="rel-group">
            <span className="ks-label">{t('releases.sort')}</span>
            <div className="rel-sort">
              <Segmented
                label={t('releases.sort')}
                options={SORT_KEYS.map((key) => ({ value: key, label: t(SORT_LABEL[key]) }))}
                value={sort.key}
                onChange={(key) => setSort({ ...sort, key })}
              />
              <IconButton
                icon="sort-desc"
                variant="filled"
                label={t(sort.descending ? 'releases.descending' : 'releases.ascending')}
                className={sort.descending ? undefined : 'rel-flip'}
                onClick={() => setSort({ ...sort, descending: !sort.descending })}
              />
            </div>
          </div>
        </div>
      </Sheet>
    </main>
  )
}

function OptionGroup<T extends string>({
  label,
  options,
  selected,
  show = (value) => value,
  onToggle,
}: {
  label: string
  options: T[]
  selected: T[]
  show?: (value: T) => string
  onToggle: (value: T) => void
}) {
  if (!options.length) return null
  return (
    <div className="rel-group" role="group" aria-label={label}>
      <span className="ks-label">{label}</span>
      <div className="rel-options">
        {options.map((value) => (
          <FilterChip key={value} selected={selected.includes(value)} onClick={() => onToggle(value)}>
            {show(value)}
          </FilterChip>
        ))}
      </div>
    </div>
  )
}

function ReleaseCard({ row }: { row: Row }) {
  const { t, i18n } = useTranslation()
  const format = useFormatters()
  const [expanded, setExpanded] = useState(false)
  const { release, info } = row
  const coverage = seasonCoverage(info) ?? (info.complete ? t('releases.complete') : undefined)
  const seeders = release.seeders ?? 0
  const badges = [
    info.resolution && { kind: 'res' as const, label: info.resolution },
    info.source && { kind: 'default' as const, label: info.source },
    info.codec && { kind: 'default' as const, label: info.codec },
    ...info.hdr.map((hdr) => ({ kind: 'hdr' as const, label: hdr === 'DV' ? 'Dolby Vision' : hdr })),
  ].filter((badge) => !!badge)

  return (
    <article className="ks-rel">
      {coverage && (
        <Badge kind="coverage" className="rel-cov">
          {coverage}
        </Badge>
      )}
      <button
        type="button"
        className={expanded ? 'rel-name' : 'rel-name ks-clamp2'}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {release.title}
      </button>
      {badges.length > 0 && (
        <div className="rel-badges">
          {badges.map((badge) => (
            <Badge key={badge.label} kind={badge.kind}>
              {badge.label}
            </Badge>
          ))}
        </div>
      )}
      {(info.audio.length > 0 || info.subs) && (
        <div className="rel-badges">
          <Icon name="audio" size={15} className="c3" />
          {info.audio.map((audio) => (
            <Badge key={audio} kind="audio">
              {t(AUDIO_LABEL[audio])}
            </Badge>
          ))}
          {info.subs && <Badge kind="subs">{t('releases.subs')}</Badge>}
        </div>
      )}
      <div className="rel-meta ks-num">
        <span className="rel-size">{format.size(release.size)}</span>
        <span
          className={seeders >= 100 ? 'c-ok' : seeders >= 20 ? 'c2' : 'c-warn'}
          aria-label={t('releases.seeders', { count: seeders })}
        >
          <Icon name="arrow-up" size={13} />
          {seeders.toLocaleString(i18n.language)}
        </span>
        <span aria-label={t('releases.leechers', { count: release.leechers ?? 0 })}>
          <Icon name="arrow-down" size={13} />
          {(release.leechers ?? 0).toLocaleString(i18n.language)}
        </span>
        <span className="ks-trunc rel-indexer">{release.indexer}</span>
        {release.publishDate && <span className="c3">{format.age(release.publishDate)}</span>}
      </div>
    </article>
  )
}
