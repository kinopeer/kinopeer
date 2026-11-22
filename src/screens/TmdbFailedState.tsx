import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { unreachable } from '../api/qbittorrent'
import { TmdbKeyError, TmdbKeyReadError } from '../api/tmdb'
import { EmptyState } from '../components/EmptyState'
import type { IconName } from '../components/Icon'
import { unreachableText } from '../lib/unreachable'
import type { SettingsLocationState } from './SettingsScreen'
import { StoreUnreadState } from './StoreUnreadState'
import { UnreachableState } from './UnreachableState'

export interface TmdbFailedStateProps {
  /** What the TMDB call threw. */
  error: unknown
  onRetry: () => void
  retryIcon?: IconName
}

/**
 * A TMDB call that a screen needs failed: no key (Enter key, to Settings' key sheet), Kinopeer's
 * server didn't answer (the connect screen's `UnreachableState`, with Open again where
 * `useMayOpenAgain` says so, #537), or TMDB didn't. The title page, Search, the phone's releases
 * and Fix match's sheet show it; from the sheet, Enter key and Open again leave the screen under it,
 * whose scroll `useScrollRestoration` saves with the offset `holdPage` holds it at (#553). In the
 * WebUI build, qBittorrent may not have given the key (`StoreUnreadState`).
 */
export function TmdbFailedState({ error, onRetry, retryIcon }: TmdbFailedStateProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  if (__WEBUI__ && error instanceof TmdbKeyReadError) return <StoreUnreadState onRetry={onRetry} retryIcon={retryIcon} />
  // `qbittorrent` here is TMDB: the server's bridge answered for it.
  const who = unreachable(error)
  if (unreachableText(who)) return <UnreachableState unreachable={who} onRetry={onRetry} texts="connect" retryIcon={retryIcon} />
  if (error instanceof TmdbKeyError) {
    return (
      <EmptyState
        icon="key"
        tone="error"
        title={t('search.keyTitle')}
        actionLabel={t('tmdbKey.enter')}
        onAction={() => navigate('/settings', { state: { editTmdbKey: true } satisfies SettingsLocationState })}
      >
        {/* The WebUI build has no server: qBittorrent keeps the key. */}
        {t(__WEBUI__ ? 'webui.tmdbKeyNeeded' : 'search.keyBody')}
      </EmptyState>
    )
  }
  return (
    <EmptyState icon="wifi-off" tone="error" title={t('search.errorTitle')} actionLabel={t('common.retry')} actionIcon={retryIcon} onAction={onRetry}>
      {t('search.errorBody')}
    </EmptyState>
  )
}
