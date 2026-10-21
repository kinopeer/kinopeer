import { useTranslation } from 'react-i18next'
import type { Torrent } from '../api/qbittorrent'
import { Poster } from '../components/Poster'
import { ProgressBar } from '../components/ProgressBar'
import { StatusChip } from '../components/StatusChip'
import { useFormatters } from '../lib/format'
import { downloadStatus } from '../torrents/status'

export interface DownloadItemProps {
  torrent: Torrent
}

export function DownloadItem({ torrent }: DownloadItemProps) {
  const { t } = useTranslation()
  const format = useFormatters()
  const status = downloadStatus(torrent)
  const partial = torrent.progress > 0 && torrent.progress < 1

  const speed =
    status === 'downloading'
      ? `↓ ${format.speed(torrent.dlspeed)}`
      : status === 'seeding'
        ? `↑ ${format.speed(torrent.upspeed)}`
        : null
  const eta = status === 'downloading' && torrent.dlspeed > 0 ? format.eta(torrent.eta) : null

  return (
    <li className="ks-dl">
      <Poster className="dl-poster">
        {torrent.priority > 0 && (
          <span className="ks-qpos" aria-label={t('downloads.queuePosition', { position: torrent.priority })}>
            #{torrent.priority}
          </span>
        )}
      </Poster>
      <div className="dl-body">
        <h2 className="dl-title ks-clamp2">{torrent.name}</h2>
        <div className="dl-progress">
          <ProgressBar
            value={torrent.progress}
            status={status}
            label={t('downloads.progress', { name: torrent.name })}
            className="dl-bar"
          />
          <span className="dl-pct ks-num c2">{format.percent(torrent.progress)}</span>
        </div>
        <div className="dl-meta ks-num">
          <StatusChip status={status}>{t(`status.${status}`)}</StatusChip>
          {speed && <span className="c2">{speed}</span>}
          {eta && <span className="c3">{eta}</span>}
          <span className="dl-size c3">
            {partial
              ? `${format.size(torrent.size * torrent.progress)} / ${format.size(torrent.size)}`
              : format.size(torrent.size)}
          </span>
        </div>
      </div>
    </li>
  )
}
