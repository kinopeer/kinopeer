import { useTranslation } from 'react-i18next'
import type { Unreachable } from '../api/qbittorrent'
import { Banner } from '../components/Banner'
import { useFormatters } from '../lib/format'
import { useNow } from '../lib/useNow'

export interface OfflineBannerProps {
  /** Who stopped answering: Kinopeer's server or qBittorrent (the default). */
  unreachable?: Unreachable
  /** When the shown state last arrived from qBittorrent. */
  updatedAt: number | null
  onRetry: () => void
}

/** qBittorrent, or Kinopeer's server, stopped answering: says which, how old the shown state is and that actions wait. */
export function OfflineBanner({ unreachable, updatedAt, onRetry }: OfflineBannerProps) {
  const { t } = useTranslation()
  const format = useFormatters()
  const now = useNow()

  return (
    <Banner tone="warning" icon="wifi-off" title={t('offline.title', { context: unreachable })} actionLabel={t('common.retry')} onAction={onRetry}>
      {updatedAt === null ? t('offline.retrying') : t('offline.updated', { ago: format.since(updatedAt, now) })}
    </Banner>
  )
}
