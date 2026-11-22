import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { unreachable } from '../api/qbittorrent'
import { TmdbKeyError, TmdbKeyReadError } from '../api/tmdb'
import { EmptyState } from '../components/EmptyState'
import type { IconName } from '../components/Icon'
import { unreachableText } from '../lib/unreachable'
import { useMainData } from '../torrents/useMainData'
import type { SettingsLocationState } from './SettingsScreen'
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
 * WebUI build, qBittorrent may not have given the key (`KeyNotRead`).
 */
export function TmdbFailedState({ error, onRetry, retryIcon }: TmdbFailedStateProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  if (__WEBUI__ && error instanceof TmdbKeyReadError) return <KeyNotRead onRetry={onRetry} retryIcon={retryIcon} />
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

/**
 * In the WebUI build, qBittorrent didn't give the TMDB key (`TmdbKeyReadError`), so it's qBittorrent
 * that didn't answer, not TMDB. It also starts the shared poll, which nothing may be running on this
 * screen: qBittorrent answers it 403 when its session has ended, and the poll's handler then brings
 * back qBittorrent's login, which Retry couldn't.
 */
function KeyNotRead({ onRetry, retryIcon }: Pick<TmdbFailedStateProps, 'onRetry' | 'retryIcon'>) {
  useMainData()
  return <UnreachableState unreachable="qbittorrent" onRetry={onRetry} texts="connect" retryIcon={retryIcon} />
}
