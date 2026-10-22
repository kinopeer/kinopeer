import { useTranslation } from 'react-i18next'
import { Banner } from '../components/Banner'
import { useFormatters } from '../lib/format'
import { useNow } from '../lib/useNow'

export interface OfflineBannerProps {
  /** When the shown state last arrived from qBittorrent. */
  updatedAt: number | null
  onRetry: () => void
}

/** qBittorrent stopped answering: says how old the shown state is and that actions wait. */
export function OfflineBanner({ updatedAt, onRetry }: OfflineBannerProps) {
  const { t } = useTranslation()
  const format = useFormatters()
  const now = useNow()

  return (
    <Banner tone="warning" icon="wifi-off" title={t('offline.title')} actionLabel={t('common.retry')} onAction={onRetry}>
      {updatedAt === null ? t('offline.retrying') : t('offline.updated', { ago: format.since(updatedAt, now) })}
    </Banner>
  )
}
