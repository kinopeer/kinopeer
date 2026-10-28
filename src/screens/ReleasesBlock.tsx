import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { FilterChip } from '../components/FilterChip'
import type { TitleDetails } from '../releases/releaseQuery'
import { AddReleaseSheet } from './AddReleaseSheet'
import type { Releases } from './useReleases'

export interface ReleasesBodyProps {
  releases: Releases
  /** Shown while the search runs, inside a status region. */
  skeleton: ReactNode
  /** The releases the filters let through, shown when there are any. */
  children: ReactNode
}

/**
 * The search's states (loading, Prowlarr not set up or unreachable, nothing found, nothing matches
 * the filters) around the list of releases, with the picked filters above it.
 */
export function ReleasesBody({ releases, skeleton, children }: ReleasesBodyProps) {
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
        <EmptyState icon="wifi-off" tone="error" title={t('releases.errorTitle')} actionLabel={t('common.retry')} actionIcon="refresh" onAction={releases.retry}>
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
  return (
    <>
      <FailingIndexers releases={releases} />
      <ActiveFilters releases={releases} />
      {releases.visible.length > 0 ? (
        children
      ) : (
        <EmptyState icon="filter" tone="muted" title={t('releases.noMatchTitle')} actionLabel={t('releases.resetFilters')} onAction={releases.clearFilters}>
          {t('releases.noMatchBody')}
        </EmptyState>
      )}
    </>
  )
}

/** A quiet note that some indexers didn't answer, so their releases are missing. */
function FailingIndexers({ releases }: { releases: Releases }) {
  const { t } = useTranslation()
  const { failing } = releases
  if (!failing.length) return null
  return (
    <Banner tone="info" icon="alert">
      {t('releases.failingIndexers', { count: failing.length, names: failing.join(', ') })}
    </Banner>
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
