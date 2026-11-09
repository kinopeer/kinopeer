import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useParams } from 'react-router'
import { TmdbError, getMovie, getTv } from '../api/tmdb'
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
import { MIN_SEEDS, SORT_KEYS, summary, toggle, type ReleaseRow } from '../releases/filterReleases'
import { seasonCoverage } from '../releases/parseRelease'
import { qualityBadges, sourceName } from '../releases/qualityBadges'
import type { TitleDetails as Details } from '../releases/releaseQuery'
import { useTmdbLanguage } from '../settings/settings'
import { IndexerLink } from './IndexerLink'
import { ReleaseName } from './ReleaseName'
import { AddingRelease, ReleasesBody } from './ReleasesBlock'
import { SortDirectionButton } from './SortDirectionButton'
import { AUDIO_LABEL, SORT_LABEL, useReleases } from './useReleases'
import './ReleasesScreen.css'

/** The phone's releases screen; on desktop the title page shows the releases (TitleReleases). */
export function ReleasesScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams()
  const type = params.type === 'movie' || params.type === 'tv' ? params.type : undefined
  const id = Number(params.id)
  const valid = type !== undefined && Number.isInteger(id) && id > 0
  const language = useTmdbLanguage()

  const details = useRequest<Details>(valid ? `${type}|${id}|${language}` : null, async (signal) =>
    type === 'movie'
      ? { ...(await getMovie(id, { language, signal })), type }
      : { ...(await getTv(id, { language, signal })), type: 'tv' },
  )
  const releases = useReleases(details.data)
  const { filters, sort, active, visible, present, resolutionLabel, audioLabel, sourceLabel, optionLabel, updateFilters } = releases
  const [sheetOpen, setSheetOpen] = useState(false)

  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate(`/title/${type}/${id}`))
  const name = details.data ? (details.data.type === 'movie' ? details.data.title : details.data.name) : ''
  const year =
    details.data &&
    (details.data.type === 'movie' ? details.data.release_date : details.data.first_air_date)?.slice(0, 4)

  const notFound = !valid || (details.error instanceof TmdbError && details.error.status === 404)

  let body
  if (notFound) {
    body = (
      <EmptyState icon="film" tone="muted" title={t('title.notFoundTitle')} actionLabel={t('title.backToSearch')} onAction={() => navigate('/search')}>
        {t('title.notFoundBody')}
      </EmptyState>
    )
  } else if (details.error) {
    body = (
      <EmptyState icon="wifi-off" tone="error" title={t('noAnswer.prowlarr')} actionLabel={t('common.retry')} actionIcon="refresh" onAction={details.retry}>
        {t('releases.errorBody')}
      </EmptyState>
    )
  } else {
    body = (
      <ReleasesBody
        releases={releases}
        skeleton={
          <div className="rel-list">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="ks-rel" aria-hidden="true">
                <div className="ks-skel" style={{ height: 16, width: '90%' }} />
                <div className="ks-skel" style={{ height: 16, width: '60%' }} />
                <div className="ks-skel" style={{ height: 22, width: '40%' }} />
              </div>
            ))}
          </div>
        }
      >
        <p className="t-cap c3 ks-num rel-count" aria-live="polite">
          {t('releases.count', { shown: visible.length, count: releases.rows.length })}
        </p>
        <ul className="rel-list">
          {visible.map((row) => (
            <li key={row.release.id}>
              <ReleaseCard row={row} onAdd={() => releases.setAdding(row)} />
            </li>
          ))}
        </ul>
      </ReleasesBody>
    )
  }

  const loading = !notFound && !details.error && releases.status === 'loading'
  const ready = !details.error && releases.status === 'ready'

  return (
    <main className="rel">
      <header className="rel-head">
        <div className="rel-bar">
          <IconButton icon="chevron-left" label={t('common.back')} iconSize={24} onClick={goBack} />
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
              {summary(filters.resolution, t('releases.resolution'), resolutionLabel)}
            </FilterChip>
            <FilterChip selected={filters.audio.length > 0} trailingIcon="chevron-down" onClick={() => setSheetOpen(true)}>
              {summary(filters.audio, t('releases.audio'), audioLabel)}
            </FilterChip>
            <FilterChip selected={filters.source.length > 0} trailingIcon="chevron-down" onClick={() => setSheetOpen(true)}>
              {summary(filters.source, t('releases.source'), sourceLabel)}
            </FilterChip>
            <FilterChip
              icon="sort"
              aria-label={`${t('common.sort')}: ${t(SORT_LABEL[sort.key])}, ${t(sort.descending ? 'common.descending' : 'common.ascending')}`}
              onClick={() => releases.pickSort(SORT_KEYS[(SORT_KEYS.indexOf(sort.key) + 1) % SORT_KEYS.length])}
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
          <Button variant="ghost" size="sm" disabled={!active.length} onClick={releases.clearFilters}>
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
            show={optionLabel(resolutionLabel)}
            onToggle={(value) => updateFilters({ resolution: toggle(filters.resolution, value) })}
          />
          <OptionGroup
            label={t('releases.audio')}
            options={[...new Set([...present.audio, ...filters.audio])]}
            selected={filters.audio}
            show={optionLabel(audioLabel)}
            onToggle={(value) => updateFilters({ audio: toggle(filters.audio, value) })}
          />
          <OptionGroup
            label={t('releases.source')}
            options={[...new Set([...present.source, ...filters.source])]}
            selected={filters.source}
            show={optionLabel(sourceLabel)}
            onToggle={(value) => updateFilters({ source: toggle(filters.source, value) })}
          />
          <div className="rel-group" role="group" aria-label={t('releases.minSeeds')}>
            <span className="ks-label">{t('releases.minSeeds')}</span>
            <div className="rel-options">
              {MIN_SEEDS.map((value) => (
                <FilterChip key={value} selected={filters.minSeeds === value} onClick={() => updateFilters({ minSeeds: value })}>
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
              onToggle={(value) => updateFilters({ indexer: toggle(filters.indexer, value) })}
            />
          )}
          <div className="rel-group">
            <span className="ks-label">{t('common.sort')}</span>
            <div className="rel-sort">
              <Segmented
                label={t('common.sort')}
                options={SORT_KEYS.map((key) => ({ value: key, label: t(SORT_LABEL[key]) }))}
                value={sort.key}
                onChange={releases.pickSort}
              />
              <SortDirectionButton descending={sort.descending} onReverse={releases.reverseSort} />
            </div>
          </div>
        </div>
      </Sheet>

      <AddingRelease releases={releases} details={details.data} />
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

function ReleaseCard({ row, onAdd }: { row: ReleaseRow; onAdd: () => void }) {
  const { t, i18n } = useTranslation()
  const format = useFormatters()
  const { release, info } = row
  const coverage = seasonCoverage(info) ?? (info.complete ? t('releases.complete') : undefined)
  const seeders = release.seeders ?? 0
  const badges = qualityBadges(info, sourceName(t))

  return (
    <article className="ks-rel">
      <div className="rel-top">
        <div className="rel-top-text">
          {coverage && (
            <Badge kind="coverage" className="rel-cov">
              {coverage}
            </Badge>
          )}
          <ReleaseName name={release.title} />
        </div>
        <IconButton icon="plus" variant="filled" label={t('add.title')} iconSize={22} className="rel-add" onClick={onAdd} />
      </div>
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
      <div className="t-cap rel-meta ks-num">
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
        <IndexerLink release={release} className="rel-indexer" />
        {release.publishDate && <span className="c3">{format.age(release.publishDate)}</span>}
      </div>
    </article>
  )
}
