import { useTranslation } from 'react-i18next'
import type { Unreachable } from '../api/qbittorrent'
import { Banner } from '../components/Banner'
import { useFormatters } from '../lib/format'
import { unreachableText, useMayOpenAgain } from '../lib/unreachable'
import { useNow } from '../lib/useNow'
import { loadPastTheShell } from '../pwa/proxySignIn'

export interface OfflineBannerProps {
  /** Who stopped answering: Kinopeer's server or qBittorrent (the default). */
  unreachable?: Unreachable
  /** When the shown state last arrived from qBittorrent. */
  updatedAt: number | null
  onRetry: () => void
}

/**
 * qBittorrent, or Kinopeer's server, stopped answering: says which, how old the shown state is and
 * that actions wait, with Retry, and Open again beside it when nothing answered for the server.
 */
export function OfflineBanner({ unreachable, updatedAt, onRetry }: OfflineBannerProps) {
  const { t } = useTranslation()
  const format = useFormatters()
  const now = useNow()
  const openAgain = useMayOpenAgain(unreachable)

  return (
    <Banner
      tone="warning"
      icon="wifi-off"
      title={t('noAnswer.qbittorrent', { context: unreachableText(unreachable) })}
      actionLabel={t('common.retry')}
      onAction={onRetry}
      secondaryActionLabel={openAgain ? t('common.openAgain') : undefined}
      onSecondaryAction={() => loadPastTheShell()}
    >
      {updatedAt === null ? t('offline.retrying') : t('offline.updated', { ago: format.since(updatedAt, now) })}
      {openAgain && (
        <>
          <br />
          {t('common.openAgainHint')}
        </>
      )}
    </Banner>
  )
}
