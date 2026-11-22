import { useTranslation } from 'react-i18next'
import { EmptyState } from '../components/EmptyState'
import { requiredQbittorrentVersion } from '../session/useQbitSession'

export interface UnsupportedQbittorrentProps {
  /** The version qBittorrent answered with. */
  version: string
  /** Checks again, once qBittorrent is updated. */
  onRetry: () => void
}

/** qBittorrent answered, but it's older than Kinopeer works with: what to do, in the connect screen's place of the form. */
export function UnsupportedQbittorrent({ version, onRetry }: UnsupportedQbittorrentProps) {
  const { t } = useTranslation()
  return (
    <EmptyState icon="alert" tone="error" title={t('unsupported.title', { version })} actionLabel={t('common.retry')} onAction={onRetry}>
      {t('unsupported.body', { min: requiredQbittorrentVersion() })}
    </EmptyState>
  )
}
