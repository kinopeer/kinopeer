import { useTranslation } from 'react-i18next'
import type { Unreachable } from '../api/qbittorrent'
import { EmptyState } from '../components/EmptyState'
import { loadPastTheShell } from '../pwa/proxySignIn'

export interface UnreachableStateProps {
  /** Who didn't answer the poll: Kinopeer's server or qBittorrent (the default). */
  unreachable?: Unreachable
  onRetry: () => void
}

/**
 * Nothing came from qBittorrent yet and the poll failed: who didn't answer, with Retry, or with Open
 * again when it's Kinopeer's server, past whatever the browser needs to confirm. Downloads and the
 * torrent details show it.
 */
export function UnreachableState({ unreachable, onRetry }: UnreachableStateProps) {
  const { t } = useTranslation()
  return (
    <EmptyState
      icon="wifi-off"
      tone="error"
      title={t('offline.unreachableTitle', { context: unreachable })}
      actionLabel={unreachable === 'kinopeer' ? t('common.openAgain') : t('common.retry')}
      onAction={unreachable === 'kinopeer' ? () => loadPastTheShell() : onRetry}
    >
      {t('offline.unreachableBody', { context: unreachable })}
    </EmptyState>
  )
}
