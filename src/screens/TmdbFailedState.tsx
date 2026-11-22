import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { unreachable } from '../api/qbittorrent'
import { TmdbKeyError } from '../api/tmdb'
import { EmptyState } from '../components/EmptyState'
import type { IconName } from '../components/Icon'
import { unreachableText, useMayOpenAgain } from '../lib/unreachable'
import { loadPastTheShell } from '../pwa/proxySignIn'
import type { SettingsLocationState } from './SettingsScreen'

export interface TmdbFailedStateProps {
  /** What the TMDB call threw. */
  error: unknown
  onRetry: () => void
  retryIcon?: IconName
}

/**
 * A TMDB call that a screen needs failed: no key (Enter key, to Settings' key sheet), Kinopeer's
 * server didn't answer (with Open again beside Retry where `useMayOpenAgain` says so, #537), or TMDB
 * didn't. The title page, Search and the phone's releases show it.
 */
export function TmdbFailedState({ error, onRetry, retryIcon }: TmdbFailedStateProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // `qbittorrent` here is TMDB: the server's bridge answered for it.
  const who = unreachable(error)
  const kinopeer = unreachableText(who)
  const openAgain = useMayOpenAgain(who)
  if (error instanceof TmdbKeyError) {
    return (
      <EmptyState
        icon="key"
        tone="error"
        title={t('search.keyTitle')}
        actionLabel={t('tmdbKey.enter')}
        onAction={() => navigate('/settings', { state: { editTmdbKey: true } satisfies SettingsLocationState })}
      >
        {t('search.keyBody')}
      </EmptyState>
    )
  }
  return (
    <EmptyState
      icon="wifi-off"
      tone="error"
      title={kinopeer ? t('noAnswer.qbittorrent', { context: kinopeer }) : t('search.errorTitle')}
      actionLabel={t('common.retry')}
      actionIcon={retryIcon}
      onAction={onRetry}
      secondaryActionLabel={openAgain ? t('common.openAgain') : undefined}
      onSecondaryAction={() => loadPastTheShell()}
    >
      {kinopeer ? t('connect.unreachableBody', { context: openAgain ? 'openAgain' : kinopeer }) : t('search.errorBody')}
    </EmptyState>
  )
}
