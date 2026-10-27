import { useTranslation } from 'react-i18next'
import type { Release } from '../api/prowlarr'
import { Icon } from '../components/Icon'
import { cx } from '../lib/cx'
import './IndexerLink.css'

interface IndexerLinkProps {
  release: Pick<Release, 'indexer' | 'infoUrl'>
  className?: string
}

/**
 * The indexer's name as a link to the release's page on the tracker, in a new tab, for what
 * Kinoseed doesn't show (the description, screenshots, comments). Plain text when Prowlarr gave no page.
 */
export function IndexerLink({ release, className }: IndexerLinkProps) {
  const { t } = useTranslation()
  const name = <span className="ks-trunc">{release.indexer}</span>
  if (!release.infoUrl) return <span className={cx('indexer', className)}>{name}</span>
  return (
    <a
      className={cx('indexer indexer-link', className)}
      href={release.infoUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('releases.openOnTracker', { indexer: release.indexer })}
    >
      {name}
      <Icon name="external-link" size={13} />
    </a>
  )
}
