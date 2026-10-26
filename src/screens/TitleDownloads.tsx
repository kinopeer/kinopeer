import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router'
import type { Torrent } from '../api/qbittorrent'
import { Badge } from '../components/Badge'
import { Icon } from '../components/Icon'
import { ProgressBar } from '../components/ProgressBar'
import { StatusChip } from '../components/StatusChip'
import { overPage } from '../lib/background'
import { useFormatters } from '../lib/format'
import { parseRelease, releaseCoverage } from '../releases/parseRelease'
import { downloadStatus, transferSpeed } from '../torrents/status'

export interface TitleDownloadsProps {
  /** The title's torrents, in the order to show them. */
  torrents: Torrent[]
}

/**
 * The title page's "In downloads" block: one card per torrent, each opening its torrent screen (on
 * desktop, its drawer over the title page).
 */
export function TitleDownloads({ torrents }: TitleDownloadsProps) {
  const { t } = useTranslation()
  if (torrents.length === 0) return null
  return (
    <section className="title-dls" aria-labelledby="title-dls">
      <h2 id="title-dls" className="t-h3 title-dls-heading">
        {t('title.inDownloads')}
        {torrents.length > 1 && (
          <>
            {' '}
            <span className="t-cap c3 ks-num">{torrents.length}</span>
          </>
        )}
      </h2>
      <ul className="title-dls-list">
        {torrents.map((torrent) => (
          <TitleDownload key={torrent.hash} torrent={torrent} />
        ))}
      </ul>
    </section>
  )
}

function TitleDownload({ torrent }: { torrent: Torrent }) {
  const { t } = useTranslation()
  const format = useFormatters()
  const location = useLocation()
  const status = downloadStatus(torrent)
  const speed = transferSpeed(torrent, status, format)
  const partial = torrent.progress > 0 && torrent.progress < 1
  const info = parseRelease(torrent.name)
  const coverage = releaseCoverage(torrent.name, info)
  const statusLabel = t(`status.${status}`)
  const percent = format.percent(torrent.progress)
  // The card's parts read as one line otherwise: "…WEB-DL41%Downloading".
  const label = [coverage, info.resolution, torrent.name, statusLabel, percent].filter(Boolean).join(', ')

  return (
    <li>
      <Link to={`/torrent/${torrent.hash}`} state={overPage(location)} className="title-dl" aria-label={label}>
        <div className="title-dl-body">
          <div className="t-cap title-dl-release">
            {coverage && <Badge>{coverage}</Badge>}{' '}
            {info.resolution && <Badge kind="res">{info.resolution}</Badge>}{' '}
            <span className="ks-trunc c3">{torrent.name}</span>
          </div>
          <div className="title-dl-progress">
            <ProgressBar
              value={torrent.progress}
              status={status}
              label={t('downloads.progress', { name: torrent.name })}
              className="title-dl-bar"
            />
            <span className="t-cap title-dl-pct ks-num c2">{percent}</span>
          </div>
          <div className="t-cap title-dl-meta ks-num">
            <StatusChip status={status}>{statusLabel}</StatusChip>
            {speed && <span className="c2">{speed}</span>}
            <span className="title-dl-size c3">
              {partial
                ? `${format.size(torrent.size * torrent.progress)} / ${format.size(torrent.size)}`
                : format.size(torrent.size)}
            </span>
          </div>
        </div>
        <Icon name="chevron-right" className="c3 title-dl-chevron" />
      </Link>
    </li>
  )
}
