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
 * The page as an absolute http(s) URL, else nothing. It comes from the indexer through Prowlarr, and
 * a `javascript:` URL in a link would run in Kinopeer's origin when clicked.
 */
function webPage(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    // Not an absolute URL. URL.canParse would say so without throwing, but Safari has it only from 17.
    return undefined
  }
}

/**
 * The indexer's name as a link to the release's page on the tracker, in a new tab, for what
 * Kinopeer doesn't show (the description, screenshots, comments). Plain text when Prowlarr gave no
 * page, or one that isn't an http(s) URL.
 */
export function IndexerLink({ release, className }: IndexerLinkProps) {
  const { t } = useTranslation()
  const name = <span className="ks-trunc">{release.indexer}</span>
  const page = webPage(release.infoUrl)
  if (!page) return <span className={cx('indexer', className)}>{name}</span>
  return (
    <a
      className={cx('indexer indexer-link touch-line', className)}
      href={page}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('releases.openOnTracker', { indexer: release.indexer })}
    >
      {name}
      <Icon name="external-link" size={13} />
    </a>
  )
}
