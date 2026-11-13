import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { FilterChip } from '../components/FilterChip'
import { formatList } from '../i18n/formatList'
import type { TitleDetails } from '../releases/releaseQuery'
import { AddReleaseSheet } from './AddReleaseSheet'
import type { Releases } from './useReleases'

export interface ReleasesBodyProps {
  releases: Releases
  /** Shown while the search runs, inside a status region. */
  skeleton: ReactNode
  /** The releases the filters let through, shown when there are any. */
  children: ReactNode
  /**
   * The count's line (`ReleasesCount`), which says which indexers didn't answer, is in `children`, so
   * it's gone when the filters let nothing through: say it in a banner there instead.
   */
  countInList?: boolean
}

/**
 * The search's states (loading, Prowlarr not set up or unreachable, nothing found, nothing matches
 * the filters) around the list of releases, with the picked filters above it. With results, the
 * count's line says which indexers didn't answer (`ReleasesCount`); with none, a banner does.
 */
export function ReleasesBody({ releases, skeleton, children, countInList = false }: ReleasesBodyProps) {
  const { t } = useTranslation()
  switch (releases.status) {
    case 'setup':
      return (
        <EmptyState icon="key" tone="error" title={t('releases.setupTitle')}>
          {t('releases.setupBody')}
        </EmptyState>
      )
    case 'error':
      return (
        <EmptyState icon="wifi-off" tone="error" title={t('noAnswer.prowlarr')} actionLabel={t('common.retry')} actionIcon="refresh" onAction={releases.retry}>
          {t('releases.errorBody')}
        </EmptyState>
      )
    case 'loading':
      return (
        <div role="status">
          <span className="sr-only">{t('releases.loading')}</span>
          {skeleton}
        </div>
      )
    case 'none':
      return (
        <>
          <FailingIndexers releases={releases} />
          <EmptyState icon="folder" tone="muted" title={t('releases.noneTitle')} actionLabel={t('common.retry')} actionIcon="refresh" onAction={releases.retry}>
            {t('releases.noneBody')}
          </EmptyState>
        </>
      )
  }
  const shown = releases.visible.length > 0
  return (
    <>
      {countInList && !shown && <FailingIndexers releases={releases} />}
      <SetAsideFilters releases={releases} />
      <ActiveFilters releases={releases} />
      {shown ? (
        children
      ) : (
        <EmptyState icon="filter" tone="muted" title={t('common.noMatchTitle')} actionLabel={t('common.resetFilters')} onAction={releases.clearFilters}>
          {t('releases.noMatchBody')}
        </EmptyState>
      )}
    </>
  )
}

/**
 * How many releases the filters show of how many were found, and how many indexers didn't answer,
 * which a tap names. The failed indexers are known only after the results, so they're said in this
 * line, there with the results, rather than in a note above the list that would push it down as it
 * came (#393). The line is a live region, so a screen reader announces them as they come.
 */
export function ReleasesCount({ releases }: { releases: Releases }) {
  const { t, i18n } = useTranslation()
  // Which search's failed indexers the names were opened for, so a new search starts with them closed.
  const [openFor, setOpenFor] = useState<string[] | null>(null)
  const id = useId()
  const { failing } = releases
  const open = failing.length > 0 && openFor === failing
  return (
    <div className="rel-count">
      <p className="t-cap c3 ks-num" aria-live="polite">
        {t('releases.count', { shown: releases.visible.length, count: releases.rows.length })}
        {failing.length > 0 && (
          <>
            {' · '}
            <button
              type="button"
              className="rel-failing touch-line"
              aria-expanded={open}
              aria-controls={open ? id : undefined}
              onClick={() => setOpenFor(open ? null : failing)}
            >
              {t('releases.failingCount', { count: failing.length })}
            </button>
          </>
        )}
      </p>
      {open && (
        <p id={id} className="t-cap c2">
          {formatList(failing, i18n, 'narrow')}
        </p>
      )}
    </div>
  )
}

/**
 * A quiet note that some indexers didn't answer, so their releases are missing, where there's no
 * count's line to say it. The names come after the search's answer, so the live region is there,
 * empty, from the start: screen readers announce a change inside a region, often not a region that
 * appears with its text.
 */
function FailingIndexers({ releases }: { releases: Releases }) {
  const { t, i18n } = useTranslation()
  const { failing } = releases
  const names = formatList(failing, i18n, 'narrow')
  return (
    <div role="status" className="rel-note">
      {failing.length > 0 && (
        <Banner tone="info" live={false}>
          {t('releases.failingIndexers', { count: failing.length, names })}
        </Banner>
      )}
    </div>
  )
}

/** The picked filter values as removable chips, and Clear all. */
function ActiveFilters({ releases }: { releases: Releases }) {
  const { t } = useTranslation()
  if (!releases.active.length) return null
  return (
    <div className="rel-active">
      {releases.active.map((filter) => (
        <FilterChip
          key={filter.key}
          selected
          trailingIcon="close"
          aria-label={t('releases.removeFilter', { label: filter.label })}
          onClick={() => releases.updateFilters(filter.remove)}
        >
          {filter.label}
        </FilterChip>
      ))}
      <Button variant="ghost" size="sm" onClick={releases.clearFilters}>
        {t('releases.clearAll')}
      </Button>
    </div>
  )
}

/** The remembered filters this search doesn't apply, and Forget. */
function SetAsideFilters({ releases }: { releases: Releases }) {
  const { t, i18n } = useTranslation()
  const { aside, resolutionLabel, audioLabel, sourceLabel } = releases
  const labels = [
    ...aside.resolution.map(resolutionLabel),
    ...aside.audio.map(audioLabel),
    ...aside.source.map(sourceLabel),
    ...(aside.minSeeds ? [t('releases.seedsPlus', { count: aside.minSeeds })] : []),
  ]
  if (!labels.length) return null
  return (
    <div className="rel-aside">
      <p className="t-cap c3">
        {t('releases.setAside', {
          filters: formatList(labels, i18n),
        })}
      </p>
      <Button variant="ghost" size="sm" onClick={releases.forgetAside}>
        {t('releases.forget')}
      </Button>
    </div>
  )
}

/** The add sheet for the release picked; after adding, Downloads with a toast. */
export function AddingRelease({ releases, details }: { releases: Releases; details: TitleDetails | undefined }) {
  const navigate = useNavigate()
  const { adding } = releases
  if (!adding || !details) return null
  const name = details.type === 'movie' ? details.title : details.name
  return (
    <AddReleaseSheet
      key={adding.release.id}
      release={adding.release}
      info={adding.info}
      title={{ type: details.type, id: details.id, name, posterPath: details.poster_path }}
      onClose={() => releases.setAdding(undefined)}
      onAdded={() => navigate('/', { state: { added: name } })}
    />
  )
}
