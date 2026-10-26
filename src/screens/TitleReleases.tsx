import { useId, useState, type ReactNode, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { FilterChip } from '../components/FilterChip'
import { IconButton } from '../components/IconButton'
import { Popover } from '../components/Popover'
import { Segmented } from '../components/Segmented'
import { useFormatters } from '../lib/format'
import { MIN_SEEDS, SORT_KEYS, summary, toggle, type ReleaseRow } from '../releases/filterReleases'
import { seasonCoverage } from '../releases/parseRelease'
import { qualityBadges } from '../releases/qualityBadges'
import type { TitleDetails } from '../releases/releaseQuery'
import { AddingRelease, ReleasesBody } from './ReleasesBlock'
import { AUDIO_LABEL, SORT_LABEL, useReleases, type Releases } from './useReleases'
import './ReleasesScreen.css'
import './TitleReleases.css'

type PopoverKey = 'resolution' | 'audio' | 'source' | 'seeds' | 'indexer'

export interface TitleReleasesProps {
  details: TitleDetails
  /** The section, for scrolling to it. */
  sectionRef?: Ref<HTMLElement>
}

/**
 * The desktop title page's releases, under the hero once Find releases is pressed: filters as
 * popovers in a sticky bar, the sort, and a table.
 */
export function TitleReleases({ details, sectionRef }: TitleReleasesProps) {
  const { t } = useTranslation()
  const releases = useReleases(details)
  const { filters, sort, present, audioLabel, updateFilters, status, visible, rows } = releases
  const [open, setOpen] = useState<PopoverKey | null>(null)

  const popover = (key: PopoverKey) => ({
    open: open === key,
    onOpenChange: (next: boolean) => setOpen(next ? key : (current) => (current === key ? null : current)),
  })
  const options = <T,>(present: T[], selected: T[]) => [...new Set([...present, ...selected])]
  const choices = <T extends string>(values: T[], selected: T[], pick: (value: T) => void, show: (value: T) => string = (value) => value) =>
    values.map((value) => (
      <FilterChip key={value} selected={selected.includes(value)} onClick={() => pick(value)}>
        {show(value)}
      </FilterChip>
    ))

  const resolutions = options(present.resolution, filters.resolution)
  const audio = options(present.audio, filters.audio)
  const sources = options(present.source, filters.source)

  return (
    <section ref={sectionRef} className="title-rel" aria-labelledby="title-rel-heading">
      <div className="title-rel-heading">
        <h2 id="title-rel-heading" className="t-h2">
          {t('releases.title')}
        </h2>
        {status === 'ready' && (
          <span className="t-cap c3 ks-num" aria-live="polite">
            {t('releases.count', { shown: visible.length, count: rows.length })}
          </span>
        )}
      </div>

      {status === 'ready' && (
        <div className={open ? 'title-rel-bar is-open' : 'title-rel-bar'}>
          {resolutions.length > 0 && (
            <FilterPopover name={t('releases.resolution')} label={summary(filters.resolution, t('releases.resolution'))} selected={filters.resolution.length > 0} {...popover('resolution')}>
              {choices(resolutions, filters.resolution, (value) => updateFilters({ resolution: toggle(filters.resolution, value) }))}
            </FilterPopover>
          )}
          {audio.length > 0 && (
            <FilterPopover name={t('releases.audio')} label={summary(filters.audio, t('releases.audio'), audioLabel)} selected={filters.audio.length > 0} {...popover('audio')}>
              {choices(audio, filters.audio, (value) => updateFilters({ audio: toggle(filters.audio, value) }), audioLabel)}
            </FilterPopover>
          )}
          {sources.length > 0 && (
            <FilterPopover name={t('releases.source')} label={summary(filters.source, t('releases.source'))} selected={filters.source.length > 0} {...popover('source')}>
              {choices(sources, filters.source, (value) => updateFilters({ source: toggle(filters.source, value) }))}
            </FilterPopover>
          )}
          <FilterPopover
            name={t('releases.minSeeds')}
            label={filters.minSeeds ? t('releases.seedsPlus', { count: filters.minSeeds }) : t('releases.minSeeds')}
            selected={filters.minSeeds > 0}
            {...popover('seeds')}
          >
            {MIN_SEEDS.map((value) => (
              <FilterChip key={value} selected={filters.minSeeds === value} onClick={() => updateFilters({ minSeeds: value })}>
                {value ? `${value}+` : t('releases.any')}
              </FilterChip>
            ))}
          </FilterPopover>
          {present.indexer.length > 1 && (
            <FilterPopover name={t('releases.indexer')} label={summary(filters.indexer, t('releases.indexer'))} selected={filters.indexer.length > 0} {...popover('indexer')}>
              {choices(present.indexer, filters.indexer, (value) => updateFilters({ indexer: toggle(filters.indexer, value) }))}
            </FilterPopover>
          )}
          <div className="title-rel-sort">
            <span className="t-cap c3" aria-hidden="true">
              {t('releases.sort')}
            </span>
            <Segmented
              label={t('releases.sort')}
              options={SORT_KEYS.map((key) => ({ value: key, label: t(SORT_LABEL[key]) }))}
              value={sort.key}
              onChange={(key) => releases.setSort({ ...sort, key })}
            />
            <IconButton
              icon="sort-desc"
              variant="filled"
              label={t(sort.descending ? 'releases.descending' : 'releases.ascending')}
              className={sort.descending ? undefined : 'rel-flip'}
              onClick={() => releases.setSort({ ...sort, descending: !sort.descending })}
            />
          </div>
        </div>
      )}

      <div className="title-rel-body" aria-busy={status === 'loading'}>
        <ReleasesBody releases={releases} skeleton={<TableSkeleton />}>
          <ReleasesTable releases={releases} />
        </ReleasesBody>
      </div>

      <AddingRelease releases={releases} details={details} />
    </section>
  )
}

interface FilterPopoverProps {
  /** The filter's name: the popover's accessible name and heading. */
  name: string
  /** The chip's label: the picked values or the filter's name. */
  label: string
  selected: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}

/** A filter chip opening its values in a popover, which follows the chip in the sticky bar. */
function FilterPopover({ name, label, selected, open, onOpenChange, children }: FilterPopoverProps) {
  const id = useId()
  const [chip, setChip] = useState<HTMLButtonElement | null>(null)

  return (
    <>
      <FilterChip
        selected={selected}
        trailingIcon="chevron-down"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(event) => {
          setChip(event.currentTarget)
          onOpenChange(!open)
        }}
      >
        {label}
      </FilterChip>
      {open && chip && (
        <Popover
          id={id}
          anchor={chip}
          align="start"
          offset={8}
          follow
          className="title-rel-pop"
          role="group"
          aria-label={name}
          onClose={() => onOpenChange(false)}
        >
          <span className="ks-label" aria-hidden="true">
            {name}
          </span>
          <div className="title-rel-options">{children}</div>
        </Popover>
      )}
    </>
  )
}

function ReleasesTable({ releases }: { releases: Releases }) {
  const { t } = useTranslation()
  return (
    <div role="table" aria-label={t('releases.title')} className="title-rel-table">
      <div role="row" className="t-cap title-rel-row title-rel-th">
        <span role="columnheader">{t('releases.colRelease')}</span>
        <span role="columnheader" className="title-rel-audio">
          {t('releases.audio')}
        </span>
        <span role="columnheader">{t('releases.colSize')}</span>
        <span role="columnheader">{t('releases.colSeeds')}</span>
        <span role="columnheader">{t('releases.colPeers')}</span>
        <span role="columnheader">{t('releases.indexer')}</span>
        <span role="columnheader">{t('releases.colAge')}</span>
        <span role="columnheader">
          <span className="sr-only">{t('add.title')}</span>
        </span>
      </div>
      {releases.visible.map((row) => (
        <ReleaseTableRow key={row.release.id} row={row} onAdd={() => releases.setAdding(row)} />
      ))}
    </div>
  )
}

function ReleaseTableRow({ row, onAdd }: { row: ReleaseRow; onAdd: () => void }) {
  const { t, i18n } = useTranslation()
  const format = useFormatters()
  const [expanded, setExpanded] = useState(false)
  const { release, info } = row
  const coverage = seasonCoverage(info) ?? (info.complete ? t('releases.complete') : undefined)
  const seeders = release.seeders ?? 0
  const badges = qualityBadges(info)
  const audio = (info.audio.length > 0 || info.subs) && (
    <>
      {info.audio.map((value) => (
        <Badge key={value} kind="audio">
          {t(AUDIO_LABEL[value])}
        </Badge>
      ))}
      {info.subs && <Badge kind="subs">{t('releases.subs')}</Badge>}
    </>
  )

  return (
    <div role="row" className="t-label title-rel-row">
      <div role="cell" className="title-rel-release">
        <button
          type="button"
          className={expanded ? 't-label rel-name' : 't-label rel-name ks-clamp2'}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {release.title}
        </button>
        {(coverage || badges.length > 0) && (
          <div className="rel-badges">
            {coverage && <Badge kind="coverage">{coverage}</Badge>}
            {badges.map((badge) => (
              <Badge key={badge.label} kind={badge.kind}>
                {badge.label}
              </Badge>
            ))}
          </div>
        )}
        {/* Below 1280px the audio column folds in here. */}
        {audio && <div className="rel-badges title-rel-audio-inline">{audio}</div>}
      </div>
      <div role="cell" className="rel-badges title-rel-audio">
        {audio}
      </div>
      <span role="cell" className="ks-num title-rel-size">
        {format.size(release.size)}
      </span>
      <span
        role="cell"
        className={`ks-num title-rel-seeds ${seeders >= 100 ? 'c-ok' : seeders >= 20 ? 'c2' : 'c-warn'}`}
        aria-label={t('releases.seeders', { count: seeders })}
      >
        {seeders.toLocaleString(i18n.language)}
      </span>
      <span role="cell" className="ks-num c2" aria-label={t('releases.leechers', { count: release.leechers ?? 0 })}>
        {(release.leechers ?? 0).toLocaleString(i18n.language)}
      </span>
      <span role="cell" className="t-cap ks-trunc c2 title-rel-small">
        {release.indexer}
      </span>
      <span role="cell" className="t-cap ks-num c3 title-rel-small">
        {release.publishDate ? format.age(release.publishDate) : ''}
      </span>
      <div role="cell" className="title-rel-add">
        <Button variant="tonal" size="sm" icon="plus" aria-label={t('add.title')} onClick={onAdd}>
          {t('releases.add')}
        </Button>
      </div>
    </div>
  )
}

function TableSkeleton() {
  return (
    <div className="title-rel-table" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="t-label title-rel-row title-rel-skel">
          <div className="title-rel-release">
            <div className="ks-skel" style={{ height: 16, width: '85%' }} />
            <div className="ks-skel" style={{ height: 22, width: '45%' }} />
          </div>
          <div className="ks-skel title-rel-audio" style={{ height: 22 }} />
          <div className="ks-skel" style={{ height: 16 }} />
          <div className="ks-skel" style={{ height: 16 }} />
          <div className="ks-skel" style={{ height: 16 }} />
          <div className="ks-skel" style={{ height: 16 }} />
          <div className="ks-skel" style={{ height: 16 }} />
          <div className="ks-skel" style={{ height: 32 }} />
        </div>
      ))}
    </div>
  )
}
