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
import { useTmdbLanguage } from '../settings/settings'
import { downloadStatus, isRunning } from '../torrents/status'
import { chooseTitle, type TitleMatch } from '../torrents/titleMatches'
import { MatchPrompt } from './MatchPrompt'

export interface TorrentActionsSheetProps {
  torrent: Torrent
  match?: TitleMatch | null
  /** The title was guessed from the release name, so the sheet asks whether it's right. */
  guessed?: boolean
  /** qBittorrent is unreachable: only opening the details and changing the title work. */
  offline: boolean
  /** Off on the torrent screen itself. */
  showDetails?: boolean
  onClose: () => void
  /** After pausing or resuming, so the list can refresh right away. */
  onChanged: () => void
  onDelete: () => void
  /** Opens the title search. */
  onChangeTitle: () => void
  /** After the guessed title was confirmed. */
  onConfirmed: () => void
}

/** Bottom sheet with a download's actions, opened from its More button. */
export function TorrentActionsSheet({
  torrent,
  match,
  guessed,
  offline,
  showDetails = true,
  onClose,
  onChanged,
  onDelete,
  onChangeTitle,
  onConfirmed,
}: TorrentActionsSheetProps) {
  const { t } = useTranslation()
  const language = useTmdbLanguage()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
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

  const confirm = async () => {
    if (!match) return
    setConfirming(true)
    setSaveFailed(false)
    try {
      await chooseTitle(torrent.hash, match, language)
      onConfirmed()
    } catch {
      setSaveFailed(true)
      setConfirming(false)
    }
  }
  const askToConfirm = !!match && guessed

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
      {askToConfirm && (
        <MatchPrompt kind="guess" busy={confirming} onChange={onChangeTitle} onConfirm={confirm} className="actions-prompt" />
      )}
      <ul className="actions-list">
        <li>
          <button type="button" className="ks-row-btn" disabled={offline || busy} onClick={toggle}>
            <Icon name={running ? 'pause' : 'play'} />
            {running ? t('torrent.pause') : t('torrent.resume')}
          </button>
        </li>
        {showDetails && (
          <li>
            <Link to={`/torrent/${torrent.hash}`} className="ks-row-btn">
              <Icon name="info" />
              {t('downloads.openDetails')}
            </Link>
          </li>
        )}
        {!askToConfirm && (
          <li>
            <button type="button" className="ks-row-btn" onClick={onChangeTitle}>
              <Icon name="film" />
              {match ? t('match.changeTitle') : t('match.pickTitle')}
            </button>
          </li>
        )}
        <li className="ks-divider actions-divider" aria-hidden="true" />
        <li>
          <button type="button" className="ks-row-btn is-danger" disabled={offline} onClick={onDelete}>
            <Icon name="trash" />
            {t('torrent.delete')}
          </button>
        </li>
      </ul>
      {failed && <Banner tone="error">{t('torrent.actionFailed')}</Banner>}
      {saveFailed && <Banner tone="error">{t('match.saveFailed')}</Banner>}
    </Sheet>
  )
}
