import { useTranslation } from 'react-i18next'
import type { Unreachable } from '../api/qbittorrent'
import { EmptyState } from '../components/EmptyState'
import { unreachableText, useMayOpenAgain } from '../lib/unreachable'
import { loadPastTheShell } from '../pwa/proxySignIn'

export interface UnreachableStateProps {
  /** Who didn't answer the poll: Kinopeer's server or qBittorrent (the default). */
  unreachable?: Unreachable
  onRetry: () => void
  /** Whose body text: the poll's (`offline.unreachableBody`, the default) or the session check's on the connect screen (`connect.unreachableBody`). */
  texts?: 'offline' | 'connect'
}

/**
 * Nothing came from qBittorrent yet and the poll failed: who didn't answer, with Retry, and Open
 * again beside it when nothing answered for Kinopeer's server (`useMayOpenAgain`). Downloads and the
 * torrent details show it.
 */
export function UnreachableState({ unreachable, onRetry, texts = 'offline' }: UnreachableStateProps) {
  const { t } = useTranslation()
  const openAgain = useMayOpenAgain(unreachable)
  return (
    <EmptyState
      icon="wifi-off"
      tone="error"
      title={t('noAnswer.qbittorrent', { context: unreachableText(unreachable) })}
      actionLabel={t('common.retry')}
      onAction={onRetry}
      secondaryActionLabel={openAgain ? t('common.openAgain') : undefined}
      onSecondaryAction={() => loadPastTheShell()}
    >
      {t(`${texts}.unreachableBody`, { context: openAgain ? 'openAgain' : unreachableText(unreachable) })}
    </EmptyState>
  )
}
