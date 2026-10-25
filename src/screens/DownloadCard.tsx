import { useTranslation } from 'react-i18next'
import { posterUrl } from '../api/tmdb'
import { Checkbox } from '../components/Checkbox'
import { IconButton } from '../components/IconButton'
import { PosterCard } from '../components/PosterCard'
import { ProgressBar } from '../components/ProgressBar'
import { StatusChip } from '../components/StatusChip'
import { cx } from '../lib/cx'
import { useFormatters } from '../lib/format'
import { downloadStatus, transferSpeed } from '../torrents/status'
import type { DownloadItemProps } from './DownloadItem'

/** A download in the poster grid: status and progress over the poster, title and a short line under it. */
export function DownloadCard({ torrent, match, showQueue = true, onMore, selected, onToggle }: DownloadItemProps) {
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
              <StatusChip status={status}>{t(`status.${status}`)}</StatusChip>
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
              onClick={() => onMore(torrent)}
            />
          )
        }
      />
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
