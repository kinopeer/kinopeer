import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { posterUrl } from '../api/tmdb'
import { Checkbox } from '../components/Checkbox'
import { Icon } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { Poster } from '../components/Poster'
import { ProgressBar } from '../components/ProgressBar'
import { StatusChip } from '../components/StatusChip'
import { cx } from '../lib/cx'
import { useFormatters } from '../lib/format'
import type { DownloadOrder, DownloadSort } from '../torrents/sort'
import { downloadStatus, isRunning, transferSpeed } from '../torrents/status'
import type { DownloadItemProps } from './DownloadItem'
import { SpeedLimitMark } from './SpeedLimitMark'

interface SortProps {
  /** The list's order, which the header of its column shows. */
  order: DownloadOrder
  /** A sortable column's header was clicked. */
  onSort: (sort: DownloadSort) => void
}

/** A sortable column's header: a button, with an arrow and `aria-sort` while the list is in its order. */
function SortHeader({
  sort,
  order,
  onSort,
  label,
  className,
  children,
}: SortProps & { sort: DownloadSort; label?: string; className?: string; children: string }) {
  const sorted = order.sort === sort
  const direction = order.descending ? 'descending' : 'ascending'
  return (
    <span role="columnheader" className={className} aria-sort={sorted ? direction : undefined}>
      <button type="button" className={cx('dl-sort', sorted && 'is-on')} onClick={() => onSort(sort)}>
        {children}
        {/* After the visible text rather than in place of it, so voice control finds the button by what it shows. */}
        {/* The space outside the span: whitespace inside it is trimmed from the name. A whitespace-only
            flex item isn't rendered, so the gap stays as it is. */}
        {label && (
          <>
            {' '}
            <span className="sr-only">{label}</span>
          </>
        )}
        {sorted && <Icon name={order.descending ? 'arrow-down' : 'arrow-up'} size={14} strokeWidth={2.4} />}
      </button>
    </span>
  )
}

/**
 * The desktop list's column headers, in the order of DownloadRow's cells. The first column, the
 * checkboxes or the queue positions, is there only while selecting or with a position to show. A
 * click on a column's name sorts by it (`onSort`); the status has no sort.
 */
export function DownloadRowHeader({ selecting, queue, ...sorting }: { selecting: boolean; queue: boolean } & SortProps) {
  const { t } = useTranslation()
  return (
    <div className="t-cap dl-row dl-row-head" role="row">
      {(selecting || queue) &&
        (selecting ? (
          <span role="columnheader">
            <span className="sr-only">{t('downloads.columns.select')}</span>
          </span>
        ) : (
          // "#" says little to a screen reader: the menu's name for this sort follows it, hidden.
          <SortHeader sort="priority" label={t('downloads.sorts.priority')} {...sorting}>
            #
          </SortHeader>
        ))}
      <span role="columnheader">
        <span className="sr-only">{t('downloads.columns.poster')}</span>
      </span>
      <SortHeader sort="name" {...sorting}>
        {t('downloads.columns.title')}
      </SortHeader>
      <SortHeader sort="progress" {...sorting}>
        {t('downloads.columns.progress')}
      </SortHeader>
      <span role="columnheader">{t('downloads.columns.status')}</span>
      <SortHeader sort="speed" {...sorting}>
        {t('downloads.columns.speed')}
      </SortHeader>
      <SortHeader sort="eta" className="dl-row-eta" {...sorting}>
        {t('downloads.columns.eta')}
      </SortHeader>
      <SortHeader sort="size" className="dl-row-size" {...sorting}>
        {t('downloads.columns.size')}
      </SortHeader>
      <span role="columnheader">
        <span className="sr-only">{t('downloads.columns.actions')}</span>
      </span>
    </div>
  )
}

/**
 * A download in the desktop list, a row of a table: queue position (with `showQueue`) or the
 * checkbox, poster, title and release, progress, status, speed with the torrent's own limits, time
 * left, size, then pause or resume and More. The title opens the details drawer. Narrower tables drop the size, then put the
 * time left under the speed.
 */
export function DownloadRow({
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
  const running = isRunning(status)
  const title = match?.title ?? torrent.name
  const speed = transferSpeed(torrent, status, format)
  const eta = status === 'downloading' && torrent.dlspeed > 0 ? format.eta(torrent.eta) : null
  const partial = torrent.progress > 0 && torrent.progress < 1
  const selecting = selected !== undefined

  const heading = (
    <>
      <span className="dl-row-heading">
        <span className="t-body dl-row-title ks-trunc">{title}</span>
        {match?.year && <span className="c3 ks-num dl-row-year">{match.year}</span>}
      </span>
      {match && <span className="t-cap dl-row-release ks-trunc c3">{torrent.name}</span>}
    </>
  )

  return (
    <div className={cx('t-cap dl-row', selected && 'is-sel')} role="row">
      {(selecting || showQueue) && (
        <span role="cell" className="dl-row-queue ks-num c3">
          {selecting ? (
            <Checkbox checked={selected} label={title} className="dl-select" onChange={() => onToggle?.(torrent)} />
          ) : (
            torrent.priority > 0 && (
              <span aria-label={t('downloads.queuePosition', { position: torrent.priority })}>{torrent.priority}</span>
            )
          )}
        </span>
      )}
      <span role="cell">
        <Poster className="dl-row-poster" src={match ? posterUrl(match.posterPath, 'w92') : undefined} />
      </span>
      <span role="cell" className="dl-row-name">
        {selecting ? (
          <span className="dl-row-main">{heading}</span>
        ) : (
          <Link to={`/torrent/${torrent.hash}`} className="dl-row-main">
            {heading}
          </Link>
        )}
      </span>
      <span role="cell" className="dl-progress">
        <ProgressBar
          value={torrent.progress}
          status={status}
          label={t('downloads.progress', { name: title })}
          className="dl-bar"
        />
        <span className="t-cap dl-pct ks-num c2">{format.percent(torrent.progress)}</span>
      </span>
      <span role="cell">
        <StatusChip status={status}>{t(`status.${status}`)}</StatusChip>
      </span>
      <span role="cell" className="ks-num c2 dl-row-speed">
        {/* The limits next to the speed, also in place of one: the status cell has no room for them. */}
        <span className="dl-row-rate">
          {speed ?? '—'}
          <SpeedLimitMark torrent={torrent} />
        </span>
        {/* Where the time left has no column of its own, it goes under the speed. */}
        {eta && <span className="dl-row-eta-inline c3">{eta}</span>}
      </span>
      <span role="cell" className="ks-num c3 dl-row-eta">
        {eta ?? '—'}
      </span>
      <span role="cell" className="ks-num c2 dl-row-size">
        {partial ? `${format.size(torrent.size * torrent.progress)} / ${format.size(torrent.size)}` : format.size(torrent.size)}
      </span>
      <span role="cell" className="dl-row-actions">
        {!selecting && (
          <>
            <IconButton
              icon={running ? 'pause' : 'play'}
              size="sm"
              label={t(running ? 'downloads.pauseItem' : 'downloads.resumeItem', { name: title })}
              disabled={disabled || busy}
              onClick={() => onToggleRunning?.(torrent)}
            />
            <IconButton
              icon="more"
              size="sm"
              label={t('downloads.moreActions', { name: title })}
              aria-haspopup="menu"
              onClick={(event) => onMore(torrent, event.currentTarget)}
            />
          </>
        )}
      </span>
    </div>
  )
}
