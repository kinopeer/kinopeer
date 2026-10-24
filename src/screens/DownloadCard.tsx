import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { posterUrl } from '../api/tmdb'
import { IconButton } from '../components/IconButton'
import { Poster } from '../components/Poster'
import { ProgressBar } from '../components/ProgressBar'
import { StatusChip } from '../components/StatusChip'
import { useFormatters } from '../lib/format'
import { downloadStatus, transferSpeed } from '../torrents/status'
import type { DownloadItemProps } from './DownloadItem'

/** A download in the poster grid: status and progress over the poster, title and a short line under it. */
export function DownloadCard({ torrent, match, onMore }: DownloadItemProps) {
  const { t } = useTranslation()
  const format = useFormatters()
  const status = downloadStatus(torrent)
  const title = match?.title ?? torrent.name
  const meta = [format.percent(torrent.progress), transferSpeed(torrent, status, format) ?? format.size(torrent.size)]

  return (
    <li className="dl-card">
      <Link to={`/torrent/${torrent.hash}`} className="dl-card-main">
        <Poster src={match ? posterUrl(match.posterPath, 'w342') : undefined}>
          {torrent.priority > 0 && (
            <span className="ks-qpos" aria-label={t('downloads.queuePosition', { position: torrent.priority })}>
              #{torrent.priority}
            </span>
          )}
          <div className="ks-poster-fade" />
          {/* Over the poster: dark tokens in both themes, like the poster's own overlays. */}
          <div className="dl-card-over" data-theme="dark">
            <StatusChip status={status}>{t(`status.${status}`)}</StatusChip>
            <ProgressBar value={torrent.progress} status={status} label={t('downloads.progress', { name: title })} />
          </div>
        </Poster>
        <div className="dl-card-text">
          <h2 className="dl-card-title ks-clamp2">{title}</h2>
          <p className="dl-card-meta ks-trunc ks-num c3">{meta.join(' · ')}</p>
        </div>
      </Link>
      <IconButton
        icon="more"
        label={t('downloads.moreActions', { name: title })}
        className="dl-card-more"
        onClick={() => onMore(torrent)}
      />
    </li>
  )
}

/** Placeholder cards while the first answer is on its way. */
export function DownloadCardSkeleton() {
  return (
    <div className="dl-card" aria-hidden="true">
      <div className="ks-skel dl-card-skel-poster" />
      <div className="dl-card-text">
        <div className="ks-skel" style={{ height: 14, width: '80%' }} />
        <div className="ks-skel" style={{ height: 10, width: '50%', marginTop: 6 }} />
      </div>
    </div>
  )
}
