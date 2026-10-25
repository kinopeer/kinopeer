import { useTranslation } from 'react-i18next'
import { cx } from '../../lib/cx'
import { useFormatters } from '../../lib/format'

export interface SidebarStatusProps {
  /** qBittorrent's version as it reports it, e.g. "v5.0.1". */
  version: string
  /** qBittorrent stopped answering. */
  offline: boolean
  /** Speeds in bytes/s and free space in bytes; undefined until known. */
  downloadSpeed?: number
  uploadSpeed?: number
  freeSpace?: number
}

/** The qBittorrent card at the bottom of the sidebar: connection, total speeds, free space. */
export function SidebarStatus({ version, offline, downloadSpeed, uploadSpeed, freeSpace }: SidebarStatusProps) {
  const { t } = useTranslation()
  const format = useFormatters()
  const speed = (value: number | undefined) => (value === undefined || offline ? '—' : format.speed(value))
  return (
    <section className="ks-side-status" aria-label="qBittorrent">
      <p className="ks-side-status-head t-cap">
        <span className={cx('ks-side-dot', offline && 'is-off')} aria-hidden="true" />
        <span className="ks-trunc">
          {offline ? t('sidebar.offline') : t('sidebar.connected', { version })}
        </span>
      </p>
      <p className="ks-side-status-speeds t-cap ks-num c2">
        <span>
          ↓<span className="sr-only">{t('downloads.downloadSpeed')}</span> {speed(downloadSpeed)}
        </span>
        <span>
          ↑<span className="sr-only">{t('downloads.uploadSpeed')}</span> {speed(uploadSpeed)}
        </span>
      </p>
      {freeSpace !== undefined && (
        <p className="t-cap ks-num c3">{t('downloads.freeSpace', { size: format.size(freeSpace) })}</p>
      )}
    </section>
  )
}
