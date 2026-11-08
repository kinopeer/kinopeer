import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { Torrent } from '../api/qbittorrent'
import { posterUrl } from '../api/tmdb'
import { Checkbox } from '../components/Checkbox'
import { IconButton } from '../components/IconButton'
import { Poster } from '../components/Poster'
import { ProgressBar } from '../components/ProgressBar'
import { StatusChip } from '../components/StatusChip'
import { cx } from '../lib/cx'
import { useFormatters } from '../lib/format'
import { ownLimits } from '../torrents/speedLimits'
import { downloadStatus, transferSpeed } from '../torrents/status'
import type { TitleMatch } from '../torrents/titleMatches'
import { SpeedLimitMark } from './SpeedLimitMark'

/**
 * The props of a download in each layout (`DownloadItem`, `DownloadRow`, `DownloadCard`). The three are
 * memoized, since a poll changes a few of hundreds of torrents: pass callbacks that keep their
 * identity, or every row renders on every poll.
 */
export interface DownloadItemProps {
  torrent: Torrent
  /** The TMDB title, once known; the row falls back to the release name. */
  match?: TitleMatch | null
  /** Shows the queue position on the poster; only the queue order makes it meaningful. */
  showQueue?: boolean
  /** Opens the row's actions, next to the More button on desktop. */
  onMore: (torrent: Torrent, anchor: HTMLElement) => void
  /** Pauses or resumes it, from a button of its own on desktop. */
  onToggleRunning?: (torrent: Torrent) => void
  /** Pausing or resuming it. */
  busy?: boolean
  /** qBittorrent is unreachable, so pausing and resuming are off. */
  disabled?: boolean
  /** Set in selection mode: the row toggles a checkbox instead of opening the torrent, and has no More button. */
  selected?: boolean
  onToggle?: (torrent: Torrent) => void
}

/** A download in the phone's list: poster, title and release, progress, status, speed and size. */
export const DownloadItem = memo(function DownloadItem({ torrent, match, showQueue = true, onMore, selected, onToggle }: DownloadItemProps) {
  const { t } = useTranslation()
  const format = useFormatters()
  const status = downloadStatus(torrent)
  const partial = torrent.progress > 0 && torrent.progress < 1
  const title = match?.title ?? torrent.name

  const speed = transferSpeed(torrent, status, format)
  const downloading = status === 'downloading'
  const eta = downloading && torrent.dlspeed > 0 ? format.eta(torrent.eta) : null
  // A download's speed and time left get their own row, and so do the mark of the torrent's own
  // limits and a seed's speed beside it: with the chip and a "done / total" size they don't fit a
  // phone's width, and wrapping left the size alone on a second line.
  const transferRow = downloading || ownLimits(torrent) !== null
  const selecting = selected !== undefined

  const content = (
    <>
      <Poster className="dl-poster" src={match ? posterUrl(match.posterPath, 'w185') : undefined}>
        {showQueue && torrent.priority > 0 && (
          <span className="ks-qpos" aria-label={t('downloads.queuePosition', { position: torrent.priority })}>
            #{torrent.priority}
          </span>
        )}
      </Poster>
      <div className="dl-body">
        <div className="dl-text">
          {match ? (
            <>
              <h2 className="t-body dl-heading">
                <span className="dl-title ks-trunc">{match.title}</span>
                {match.year && <span className="t-cap c3 ks-num dl-year">{match.year}</span>}
              </h2>
              <p className="t-cap dl-release ks-trunc c3">{torrent.name}</p>
            </>
          ) : (
            <h2 className="t-body dl-title ks-clamp2">{torrent.name}</h2>
          )}
        </div>
        <div className="dl-progress">
          <ProgressBar
            value={torrent.progress}
            status={status}
            label={t('common.progressOf', { name: title })}
            className="dl-bar"
          />
          <span className="t-cap dl-pct ks-num c2">{format.percent(torrent.progress)}</span>
        </div>
        <div className="t-cap dl-meta ks-num">
          <StatusChip status={status}>{t(`status.${status}`)}</StatusChip>
          {!transferRow && speed && <span className="c2">{speed}</span>}
          <span className="dl-size c3">
            {partial
              ? `${format.size(torrent.size * torrent.progress)} / ${format.size(torrent.size)}`
              : format.size(torrent.size)}
          </span>
        </div>
        {transferRow && (
          <div className="t-cap dl-transfer ks-num">
            {speed && <span className="c2">{speed}</span>}
            <SpeedLimitMark torrent={torrent} className="c2" />
            {eta && <span className="dl-eta c3">{eta}</span>}
          </div>
        )}
      </div>
    </>
  )

  return (
    <li className={cx('ks-dl', selecting && 'is-selecting', selected && 'is-sel')}>
      {selecting ? (
        <>
          <Checkbox checked={selected} label={title} className="dl-select dl-row-check" onChange={() => onToggle?.(torrent)} />
          <div className="ks-dl-main">{content}</div>
        </>
      ) : (
        <>
          <Link to={`/torrent/${torrent.hash}`} className="ks-dl-main">
            {content}
          </Link>
          <IconButton
            icon="more"
            label={t('downloads.moreActions', { name: title })}
            className="dl-more"
            onClick={(event) => onMore(torrent, event.currentTarget)}
          />
        </>
      )}
    </li>
  )
})
