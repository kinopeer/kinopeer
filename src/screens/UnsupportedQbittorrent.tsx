import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '../components/EmptyState'
import { requiredQbittorrentVersion } from '../session/useQbitSession'
import { QbittorrentInterfaceDialog } from './QbittorrentInterfaceDialog'

export interface UnsupportedQbittorrentProps {
  /** The version qBittorrent answered with. */
  version: string
  /** Checks again, once qBittorrent is updated. */
  onRetry: () => void
}

/**
 * qBittorrent answered, but it's older than Kinopeer works with: what to do, in the connect screen's
 * place of the form. Where qBittorrent serves Kinopeer, also the way back to qBittorrent's own
 * interface, since Kinopeer can't be used there at all: the session is signed in, as the version
 * came from it, and every qBittorrent takes the setting.
 */
export function UnsupportedQbittorrent({ version, onRetry }: UnsupportedQbittorrentProps) {
  const { t } = useTranslation()
  const [switching, setSwitching] = useState(false)
  return (
    <>
      <EmptyState
        icon="alert"
        tone="error"
        title={t('unsupported.title', { version })}
        actionLabel={t('common.retry')}
        onAction={onRetry}
        {...(__WEBUI__ && { secondaryActionLabel: t('webui.switchInterface'), onSecondaryAction: () => setSwitching(true) })}
      >
        {t('unsupported.body', { min: requiredQbittorrentVersion() })}
      </EmptyState>
      {/* The build reads first, so the server's leaves the dialog out. */}
      {__WEBUI__ && switching && <QbittorrentInterfaceDialog onClose={() => setSwitching(false)} onSessionEnded={onRetry} />}
    </>
  )
}
