import { useTranslation } from 'react-i18next'
import type { SourceAddress } from '../api/settings'
import { Banner } from '../components/Banner'
import { SERVICE_NAMES } from '../lib/failureText'

export interface LocalhostHintProps {
  service: keyof typeof SERVICE_NAMES
  /** The same address at the host, from the server; without it the hint says what to enter instead. */
  hostAddress?: string
  /** Puts the host's address into the form's field. */
  onUse: (address: string) => void
}

/**
 * Under a form's address that didn't answer as the service, for an address on localhost while
 * Kinopeer runs in a container: that localhost is Kinopeer itself (#509).
 */
export function LocalhostHint({ service, hostAddress, onUse }: LocalhostHintProps) {
  const { t } = useTranslation()
  return (
    <Banner
      tone="info"
      title={t('container.localhostTitle')}
      actionLabel={hostAddress && t('container.useHostAddress')}
      onAction={hostAddress ? () => onUse(hostAddress) : undefined}
    >
      {t('container.localhostBody', { service: SERVICE_NAMES[service], address: hostAddress, context: hostAddress ? 'host' : undefined })}
    </Banner>
  )
}

/** On qBittorrent's login, when its auth bypass doesn't cover where it sees Kinopeer come from (#509). */
export function BypassHint({ source }: { source: SourceAddress }) {
  const { t } = useTranslation()
  return (
    <Banner tone="info" title={t('container.bypassTitle')}>
      {t('container.bypassBody', { address: source.address, subnet: source.subnet })}
    </Banner>
  )
}
