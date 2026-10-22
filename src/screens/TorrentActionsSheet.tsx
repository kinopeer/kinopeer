import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { startTorrents, stopTorrents, type Torrent } from '../api/qbittorrent'
import { posterUrl } from '../api/tmdb'
import { Banner } from '../components/Banner'
import { Icon } from '../components/Icon'
import { Poster } from '../components/Poster'
import { Sheet } from '../components/Sheet'
import { StatusChip } from '../components/StatusChip'
import { downloadStatus, isRunning } from '../torrents/status'
import type { TitleMatch } from '../torrents/titleMatches'

export interface TorrentActionsSheetProps {
  torrent: Torrent
  match?: TitleMatch | null
  /** qBittorrent is unreachable: only opening the details works. */
  offline: boolean
  onClose: () => void
  /** After pausing or resuming, so the list can refresh right away. */
  onChanged: () => void
  onDelete: () => void
}

/** Bottom sheet with a download's actions, opened from the row's More button. */
export function TorrentActionsSheet({ torrent, match, offline, onClose, onChanged, onDelete }: TorrentActionsSheetProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const status = downloadStatus(torrent)
  const running = isRunning(status)

  const toggle = async () => {
    setBusy(true)
    setFailed(false)
    try {
      await (running ? stopTorrents([torrent.hash]) : startTorrents([torrent.hash]))
      onChanged()
      onClose()
    } catch {
      setFailed(true)
      setBusy(false)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={match?.title ?? torrent.name}
      subtitle={match ? torrent.name : undefined}
      leading={<Poster src={match ? posterUrl(match.posterPath, 'w185') : undefined} className="actions-poster" />}
      action={<StatusChip status={status}>{t(`status.${status}`)}</StatusChip>}
      className="actions-sheet"
    >
      <ul className="actions-list">
        <li>
          <button type="button" className="ks-row-btn" disabled={offline || busy} onClick={toggle}>
            <Icon name={running ? 'pause' : 'play'} />
            {running ? t('torrent.pause') : t('torrent.resume')}
          </button>
        </li>
        <li>
          <Link to={`/torrent/${torrent.hash}`} className="ks-row-btn">
            <Icon name="info" />
            {t('downloads.openDetails')}
          </Link>
        </li>
        <li className="ks-divider actions-divider" aria-hidden="true" />
        <li>
          <button type="button" className="ks-row-btn is-danger" disabled={offline} onClick={onDelete}>
            <Icon name="trash" />
            {t('torrent.delete')}
          </button>
        </li>
      </ul>
      {failed && <Banner tone="error">{t('torrent.actionFailed')}</Banner>}
    </Sheet>
  )
}
