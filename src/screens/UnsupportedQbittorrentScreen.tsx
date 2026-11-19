import { useTranslation } from 'react-i18next'
import { EmptyState } from '../components/EmptyState'
import { MIN_QBITTORRENT_VERSION } from '../torrents/qbittorrentVersion'
import { Preferences } from './Preferences'
import './ConnectScreen.css'

export interface UnsupportedQbittorrentScreenProps {
  /** The version qBittorrent answered with. */
  version: string
  /** Checks again, once qBittorrent is updated. */
  onRetry: () => void
}

/** qBittorrent answered, but it's older than Kinopeer works with: what to do, in place of the app. */
export function UnsupportedQbittorrentScreen({ version, onRetry }: UnsupportedQbittorrentScreenProps) {
  const { t } = useTranslation()
  return (
    <main className="screen connect">
      <section className="connect-form connect-unreachable">
        <EmptyState
          icon="alert"
          tone="error"
          title={t('unsupported.title', { version })}
          actionLabel={t('common.retry')}
          onAction={onRetry}
        >
          {t('unsupported.body', { min: MIN_QBITTORRENT_VERSION })}
        </EmptyState>
      </section>
      <Preferences />
    </main>
  )
}
