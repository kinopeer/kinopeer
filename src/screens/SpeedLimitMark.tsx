import { useTranslation } from 'react-i18next'
import type { Torrent } from '../api/qbittorrent'
import { Icon } from '../components/Icon'
import { cx } from '../lib/cx'
import { useFormatters } from '../lib/format'
import { describeLimits, ownLimits } from '../torrents/speedLimits'

/**
 * A download's own speed limits, as a gauge with an arrow for each direction that has one, whatever
 * the torrent is doing now; nothing without them. It marks the limits: they're changed from the More
 * menu.
 */
export function SpeedLimitMark({ torrent, className }: { torrent: Pick<Torrent, 'dl_limit' | 'up_limit'>; className?: string }) {
  const { t } = useTranslation()
  const format = useFormatters()
  const limits = ownLimits(torrent)
  if (!limits) return null
  return (
    <span className={cx('dl-limit', className)} role="img" aria-label={describeLimits(limits, 'mark', t, format)}>
      <Icon name="gauge" size={14} />
      {limits.download !== undefined && '↓'}
      {limits.upload !== undefined && '↑'}
    </span>
  )
}
