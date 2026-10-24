import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { Torrent } from '../api/qbittorrent'
import { posterUrl } from '../api/tmdb'
import { IconButton } from '../components/IconButton'
import { Poster } from '../components/Poster'
import { ProgressBar } from '../components/ProgressBar'
import { StatusChip } from '../components/StatusChip'
import { useFormatters } from '../lib/format'
import { downloadStatus, transferSpeed } from '../torrents/status'
import type { TitleMatch } from '../torrents/titleMatches'

export interface DownloadItemProps {
  torrent: Torrent
  /** The TMDB title, once known; the row falls back to the release name. */
  match?: TitleMatch | null
  /** Opens the row's actions. */
  onMore: (torrent: Torrent) => void
}

export function DownloadItem({ torrent, match, onMore }: DownloadItemProps) {
  const { t } = useTranslation()
  const format = useFormatters()
  const status = downloadStatus(torrent)
  const partial = torrent.progress > 0 && torrent.progress < 1
  const title = match?.title ?? torrent.name

  const speed = transferSpeed(torrent, status, format)
  const eta = status === 'downloading' && torrent.dlspeed > 0 ? format.eta(torrent.eta) : null

  return (
    <li className="ks-dl">
      <Link to={`/torrent/${torrent.hash}`} className="ks-dl-main">
        <Poster className="dl-poster" src={match ? posterUrl(match.posterPath, 'w185') : undefined}>
          {torrent.priority > 0 && (
            <span className="ks-qpos" aria-label={t('downloads.queuePosition', { position: torrent.priority })}>
              #{torrent.priority}
            </span>
          )}
        </Poster>
        <div className="dl-body">
          {match ? (
            <>
              <h2 className="dl-heading">
                <span className="dl-title ks-trunc">{match.title}</span>
                {match.year && <span className="t-cap c3 ks-num dl-year">{match.year}</span>}
              </h2>
              <p className="dl-release ks-trunc c3">{torrent.name}</p>
            </>
          ) : (
            <h2 className="dl-title ks-clamp2">{torrent.name}</h2>
          )}
          <div className="dl-progress">
            <ProgressBar
              value={torrent.progress}
              status={status}
              label={t('downloads.progress', { name: title })}
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
      </Link>
      <IconButton
        icon="more"
        label={t('downloads.moreActions', { name: title })}
        className="dl-more"
        onClick={() => onMore(torrent)}
      />
    </li>
  )
}
