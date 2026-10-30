import { useId, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { Torrent } from '../api/qbittorrent'
import { posterUrl } from '../api/tmdb'
import { Banner } from '../components/Banner'
import { Icon } from '../components/Icon'
import { Menu, MenuDivider, MenuGroup, MenuItem, MenuLink } from '../components/Menu'
import { Poster } from '../components/Poster'
import { Sheet } from '../components/Sheet'
import { StatusChip } from '../components/StatusChip'
import { useIsDesktop } from '../lib/useIsDesktop'
import { REQUEST_KINDS } from '../torrents/requestKinds'
import { downloadStatus, hasMetadata, isRunning } from '../torrents/status'
import type { TitleMatch } from '../torrents/titleMatches'
import { MatchPrompt } from './MatchPrompt'
import { usePauseResume } from './usePauseResume'
import { useReannounce } from './useReannounce'
import { useConfirmTitle } from './useTitleChoice'
import { useTorrentAction, type ActionWatcher } from './useTorrentAction'

export interface TorrentActionsSheetProps {
  torrent: Torrent
  match?: TitleMatch | null
  /** The title was guessed from the release name, so the sheet asks whether it's right. */
  guessed?: boolean
  /** qBittorrent is unreachable: only opening the details and changing the title work. */
  offline: boolean
  /** Off on the torrent screen itself. */
  showDetails?: boolean
  /** The More button that opened it: on desktop the actions are a menu next to it rather than a sheet. */
  anchor?: HTMLElement | null
  /** Set when the title's page is already open under a drawer: its item closes the drawer instead. */
  onTitlePage?: () => void
  /**
   * Also once qBittorrent took a pause, resume or reannounce for its torrent, or its title was
   * confirmed, from here or elsewhere.
   */
  onClose: () => void
  onDelete: () => void
  /** Opens "Move files". */
  onMove: () => void
  /** Opens the recheck confirmation. */
  onRecheck: () => void
  /** Opens the speed limits sheet. */
  onSpeedLimits: () => void
  /** Opens the title search. */
  onChangeTitle: () => void
}

/** A download's actions, opened from its More button: a bottom sheet, or a menu on desktop. */
export function TorrentActionsSheet({
  torrent,
  match,
  guessed,
  offline,
  showDetails = true,
  anchor,
  onTitlePage,
  onClose,
  onDelete,
  onMove,
  onRecheck,
  onSpeedLimits,
  onChangeTitle,
}: TorrentActionsSheetProps) {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  // The menu shows the torrent, so it says how its pause, resume or reannounce went, wherever it was
  // sent from: it closes, or shows the failure.
  const watcher: ActionWatcher = {
    torrents: [torrent],
    settled: (outcome) => (outcome.ok ? onClose() : setFailed(true)),
  }
  const pauseResume = usePauseResume(watcher)
  const reannounce = useReannounce(watcher)
  // And how "Yes, right" went, the failure under its own message.
  const title = useConfirmTitle({
    torrents: [torrent],
    settled: (outcome) => (outcome.ok ? onClose() : setSaveFailed(true)),
  })
  // A recheck or a delete is sent from its confirmation, and says itself how it went.
  const recheck = useTorrentAction(REQUEST_KINDS.recheck)
  // Nothing is sent for a torrent being deleted: a title saved after it would stay for a torrent
  // that's gone.
  const deleting = useTorrentAction(REQUEST_KINDS.delete).busy(torrent.hash)
  // One of its requests at a time, from here or elsewhere.
  const busy =
    pauseResume.busy(torrent.hash) || reannounce.busy(torrent.hash) || recheck.busy(torrent.hash) || deleting
  const confirming = title.busy(torrent.hash)
  const status = downloadStatus(torrent)
  const running = isRunning(status)
  // qBittorrent ignores both where they can't run (libtorrent announces only for a started torrent,
  // and there's nothing to check before a magnet link has its metadata, whatever its state), so the
  // toast would be untrue.
  const canReannounce = status === 'downloading' || status === 'seeding'
  const noMetadata = !hasMetadata(torrent)
  const canRecheck = status !== 'checking' && !noMetadata
  // Why an item is off, under its label.
  const reannounceHint = canReannounce ? undefined : t('torrent.reannounceOff')
  const recheckHint = canRecheck
    ? undefined
    : noMetadata
      ? t('torrent.recheckNoMetadata')
      : t('torrent.recheckChecking')
  const hintId = useId()

  const toggle = () => {
    setFailed(false)
    void pauseResume.toggle(torrent)
  }

  const announce = () => {
    setFailed(false)
    void reannounce.reannounce(torrent)
  }

  const confirm = () => {
    if (!match) return
    setSaveFailed(false)
    void title.confirm(torrent, match)
  }
  const askToConfirm = !!match && guessed
  const openTitle = (event: MouseEvent) => {
    if (!onTitlePage) return onClose()
    event.preventDefault()
    onTitlePage()
  }
  const isDesktop = useIsDesktop()
  const errors = (
    <>
      {failed && <Banner tone="error">{t('torrent.actionFailed')}</Banner>}
      {saveFailed && <Banner tone="error">{t('match.saveFailed')}</Banner>}
    </>
  )

  if (isDesktop && anchor) {
    const changeTitle = match ? t('match.changeTitle') : t('match.pickTitle')
    return (
      <Menu
        anchor={anchor}
        label={t('downloads.moreActions', { name: match?.title ?? torrent.name })}
        onClose={onClose}
        footer={errors}
      >
        <MenuItem icon={running ? 'pause' : 'play'} disabled={offline || busy} onClick={toggle}>
          {running ? t('torrent.pause') : t('torrent.resume')}
        </MenuItem>
        <MenuItem icon="refresh" disabled={offline || busy || !canReannounce} hint={reannounceHint} onClick={announce}>
          {t('torrent.reannounce')}
        </MenuItem>
        <MenuItem icon="check-circle" disabled={offline || busy || !canRecheck} hint={recheckHint} onClick={onRecheck}>
          {t('torrent.recheck')}
        </MenuItem>
        <MenuItem icon="gauge" disabled={offline || deleting} onClick={onSpeedLimits}>
          {t('limits.title')}
        </MenuItem>
        {showDetails && (
          <MenuLink to={`/torrent/${torrent.hash}`} icon="info" onClick={onClose}>
            {t('downloads.openDetails')}
          </MenuLink>
        )}
        {match && (
          <MenuLink to={`/title/${match.type}/${match.id}`} icon={match.type === 'tv' ? 'tv' : 'film'} onClick={openTitle}>
            {match.type === 'tv' ? t('downloads.seriesPage') : t('downloads.moviePage')}
          </MenuLink>
        )}
        {askToConfirm ? (
          <>
            <MenuDivider />
            <MenuGroup label={t('match.guessNote')}>
              <MenuItem icon="search" disabled={confirming || deleting} onClick={onChangeTitle}>
                {t('match.change')}
              </MenuItem>
              <MenuItem icon="check" disabled={confirming || deleting} onClick={confirm}>
                {t('match.confirm')}
              </MenuItem>
            </MenuGroup>
          </>
        ) : (
          <MenuItem icon="search" disabled={deleting} onClick={onChangeTitle}>
            {changeTitle}
          </MenuItem>
        )}
        <MenuItem icon="folder" disabled={offline || deleting} onClick={onMove}>
          {t('torrent.move')}
        </MenuItem>
        <MenuDivider />
        <MenuItem icon="trash" danger disabled={offline || deleting} onClick={onDelete}>
          {t('torrent.delete')}
        </MenuItem>
      </Menu>
    )
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
      {askToConfirm && (
        <MatchPrompt
          kind="guess"
          busy={confirming}
          disabled={deleting}
          onChange={onChangeTitle}
          onConfirm={confirm}
          className="actions-prompt"
        />
      )}
      <ul className="actions-list">
        <li>
          <button type="button" className="ks-row-btn" disabled={offline || busy} onClick={toggle}>
            <Icon name={running ? 'pause' : 'play'} />
            {running ? t('torrent.pause') : t('torrent.resume')}
          </button>
        </li>
        <li>
          <button
            type="button"
            className="ks-row-btn"
            disabled={offline || busy || !canReannounce}
            aria-describedby={reannounceHint ? `${hintId}-reannounce` : undefined}
            onClick={announce}
          >
            <Icon name="refresh" />
            <RowText id={`${hintId}-reannounce`} hint={reannounceHint}>
              {t('torrent.reannounce')}
            </RowText>
          </button>
        </li>
        <li>
          <button
            type="button"
            className="ks-row-btn"
            disabled={offline || busy || !canRecheck}
            aria-describedby={recheckHint ? `${hintId}-recheck` : undefined}
            onClick={onRecheck}
          >
            <Icon name="check-circle" />
            <RowText id={`${hintId}-recheck`} hint={recheckHint}>
              {t('torrent.recheck')}
            </RowText>
          </button>
        </li>
        <li>
          <button type="button" className="ks-row-btn" disabled={offline || deleting} onClick={onSpeedLimits}>
            <Icon name="gauge" />
            {t('limits.title')}
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
        {match && (
          <li>
            <Link to={`/title/${match.type}/${match.id}`} className="ks-row-btn" onClick={onTitlePage && openTitle}>
              <Icon name={match.type === 'tv' ? 'tv' : 'film'} />
              {match.type === 'tv' ? t('downloads.seriesPage') : t('downloads.moviePage')}
            </Link>
          </li>
        )}
        {!askToConfirm && (
          <li>
            <button type="button" className="ks-row-btn" disabled={deleting} onClick={onChangeTitle}>
              <Icon name="search" />
              {match ? t('match.changeTitle') : t('match.pickTitle')}
            </button>
          </li>
        )}
        <li>
          <button type="button" className="ks-row-btn" disabled={offline || deleting} onClick={onMove}>
            <Icon name="folder" />
            {t('torrent.move')}
          </button>
        </li>
        <li className="ks-divider actions-divider" aria-hidden="true" />
        <li>
          <button type="button" className="ks-row-btn is-danger" disabled={offline || deleting} onClick={onDelete}>
            <Icon name="trash" />
            {t('torrent.delete')}
          </button>
        </li>
      </ul>
      {errors}
    </Sheet>
  )
}

/** A sheet row's label, with a dimmed hint under it (the button's description) when there is one. */
function RowText({ id, hint, children }: { id: string; hint?: string; children: string }) {
  if (!hint) return children
  return (
    <span className="ks-row-text">
      <span>{children}</span>
      <span id={id} className="ks-row-hint" aria-hidden="true">
        {hint}
      </span>
    </span>
  )
}
