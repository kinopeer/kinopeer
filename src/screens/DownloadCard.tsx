import { useTranslation } from 'react-i18next'
import { posterUrl } from '../api/tmdb'
import { Checkbox } from '../components/Checkbox'
import { IconButton } from '../components/IconButton'
import { PosterCard } from '../components/PosterCard'
import { ProgressBar } from '../components/ProgressBar'
import { StatusChip } from '../components/StatusChip'
import { cx } from '../lib/cx'
import { useFormatters } from '../lib/format'
import { downloadStatus, isRunning, transferSpeed } from '../torrents/status'
import type { DownloadItemProps } from './DownloadItem'
import { SpeedLimitMark } from './SpeedLimitMark'

/**
 * A download in the poster grid: status, the torrent's own speed limits and progress over the poster,
 * title and a short line under it.
 */
export function DownloadCard({
  torrent,
  match,
  showQueue = true,
  onMore,
  onToggleRunning,
  busy,
  disabled,
  selected,
  onToggle,
}: DownloadItemProps) {
  const { t } = useTranslation()
  const format = useFormatters()
  const status = downloadStatus(torrent)
  const title = match?.title ?? torrent.name
  const meta = [format.percent(torrent.progress), transferSpeed(torrent, status, format) ?? format.size(torrent.size)]
  const selecting = selected !== undefined

  return (
    <li className={cx('dl-card', selected && 'is-sel')}>
      <PosterCard
        title={title}
        subtitle={meta.join(' · ')}
        posterUrl={match ? posterUrl(match.posterPath, 'w342') : undefined}
        to={selecting ? undefined : `/torrent/${torrent.hash}`}
        overlay={
          <>
            {showQueue && torrent.priority > 0 && (
              <span className="ks-qpos" aria-label={t('downloads.queuePosition', { position: torrent.priority })}>
                #{torrent.priority}
              </span>
            )}
            <div className="ks-poster-fade" />
            {/* Over the poster: dark tokens in both themes, like the poster's own overlays. */}
            <div className="dl-card-over" data-theme="dark">
              <span className="dl-card-status">
                <StatusChip status={status}>{t(`status.${status}`)}</StatusChip>
                {/* Here rather than next to the speed: the line under the poster has no room for it. */}
                <SpeedLimitMark torrent={torrent} className="c2" />
              </span>
              <ProgressBar value={torrent.progress} status={status} label={t('downloads.progress', { name: title })} />
            </div>
          </>
        }
        action={
          selecting ? undefined : (
            <IconButton
              icon="more"
              label={t('downloads.moreActions', { name: title })}
              className="dl-card-more"
              aria-haspopup={onToggleRunning ? 'menu' : undefined}
              onClick={(event) => onMore(torrent, event.currentTarget)}
            />
          )
        }
      />
      {!selecting && onToggleRunning && (
        // Over the poster's corner on desktop, shown on hover and focus.
        <IconButton
          icon={isRunning(status) ? 'pause' : 'play'}
          variant="glass"
          size="sm"
          label={t(isRunning(status) ? 'downloads.pauseItem' : 'downloads.resumeItem', { name: title })}
          className="dl-card-toggle"
          data-theme="dark"
          disabled={disabled || busy}
          onClick={() => onToggleRunning(torrent)}
        />
      )}
      {selecting && (
        <Checkbox
          checked={selected}
          label={title}
          className="dl-select dl-card-check"
          data-theme="dark"
          onChange={() => onToggle?.(torrent)}
        />
      )}
    </li>
  )
}
