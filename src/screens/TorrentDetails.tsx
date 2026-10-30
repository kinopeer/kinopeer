import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { matchPath, useLocation, useNavigate } from 'react-router'
import { getTorrentTrackers, type Torrent } from '../api/qbittorrent'
import { posterUrl } from '../api/tmdb'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { Poster } from '../components/Poster'
import { ProgressBar } from '../components/ProgressBar'
import { StatusChip } from '../components/StatusChip'
import { useToast } from '../components/Toast'
import { cx } from '../lib/cx'
import { useFormatters } from '../lib/format'
import { useRequest } from '../lib/useRequest'
import { useTmdbLanguage } from '../settings/settings'
import { downloadStatus, isRunning } from '../torrents/status'
import { useServerMatches } from '../torrents/serverMatches'
import { chooseTitle, isGuessed, useTitleMatches } from '../torrents/titleMatches'
import { trackerHosts } from '../torrents/trackers'
import { useMainData } from '../torrents/useMainData'
import { ChangeTitleSheet } from './ChangeTitleSheet'
import { DeleteTorrentDialog } from './DeleteTorrentDialog'
import { MatchPrompt } from './MatchPrompt'
import { OfflineBanner } from './OfflineBanner'
import { RecheckDialog } from './RecheckDialog'
import { TorrentActionsSheet } from './TorrentActionsSheet'
import { useMoveTorrent } from './useMoveTorrent'
import { usePauseResume } from './usePauseResume'
import { useSpeedLimits } from './useSpeedLimits'
import { useTorrentOverlay } from './useTorrentOverlay'
import { TorrentFiles } from './TorrentFiles'
import './TorrentScreen.css'

export interface TorrentDetailsProps {
  /** The torrent's info hash. */
  hash: string
  /** qBittorrent rejected the session cookie (expired or signed out elsewhere). */
  onSessionLost?: () => void
  /**
   * Set in the desktop drawer: a Close button replaces Back and calls it, and the title is an h2
   * with `titleId`, so the drawer can be named by it. Unset, this is the phone's full screen.
   */
  onClose?: () => void
  titleId?: string
  /** After deleting the torrent, in place of going to Downloads with a toast. */
  onDeleted?: () => void
  /** The path of the page the drawer is over, when it isn't Downloads. */
  behind?: string
}

/** "12 (340)": connected, then in the swarm when a tracker reported it. */
function peerCount(connected: number, total: number | undefined): string {
  return total !== undefined && total >= 0 ? `${connected} (${total})` : String(connected)
}

/**
 * What Kinoseed shows about a torrent: status and progress, pause, resume and delete (recheck and
 * reannounce in its More menu), the title (with "Is it right?" for a guess), details and files. A
 * screen of its own on a phone, the content of the details drawer on desktop.
 */
export function TorrentDetails({ hash, onSessionLost, onClose, titleId, onDeleted, behind }: TorrentDetailsProps) {
  const { t, i18n } = useTranslation()
  const format = useFormatters()
  const navigate = useNavigate()
  const location = useLocation()
  const { data, offline, updatedAt, refresh } = useMainData(onSessionLost)
  const move = useMoveTorrent({ torrents: data?.torrents, offline, refresh })
  const torrent: Torrent | undefined = data?.torrents[hash]

  const torrents = useMemo(() => (torrent ? [torrent] : []), [torrent])
  const match = useTitleMatches(torrents)[hash]
  // Only this screen's torrent, so its title is the one the sheet and a failure's toast name.
  const loaded = data !== null
  const own = useMemo(() => (loaded ? (torrent ? { [hash]: torrent } : {}) : undefined), [loaded, torrent, hash])
  const titleOf = (item: Torrent) => match?.title ?? item.name
  const limits = useSpeedLimits({ torrents: own, offline, refresh, titleOf })
  const stored = useServerMatches()?.[hash]
  const language = useTmdbLanguage()

  const [detailsOpen, setDetailsOpen] = useState(false)
  const pauseResume = usePauseResume()
  // Each closes when another torrent with the same hash replaces this screen's.
  const confirm = useTorrentOverlay(own)
  const menu = useTorrentOverlay(own)
  // The More button that opened the actions, which on desktop are a menu next to it.
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const menuOpen = menu.torrent ? menuAnchor : null
  const closeMenu = () => {
    setMenuAnchor(null)
    menu.close()
  }
  const retitle = useTorrentOverlay(own)
  const recheck = useTorrentOverlay(own)
  const [savingTitle, setSavingTitle] = useState(false)
  const toast = useToast()
  const titleSaved = (result: 'changed' | 'confirmed' | 'failed') =>
    result === 'failed'
      ? toast.show(t('match.saveFailed'), { icon: 'alert' })
      : toast.show(result === 'confirmed' ? t('match.confirmed') : t('match.changed'))

  const trackers = useRequest(detailsOpen && torrent ? `trackers|${hash}` : null, () => getTorrentTrackers(hash))

  const drawer = onClose !== undefined
  const Root = drawer ? 'div' : 'main'
  const Heading = drawer ? 'h2' : 'h1'
  // Opened from inside the app: go back. Opened from a shared link: there's nothing to go back to.
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/'))
  const backButton = drawer ? (
    <IconButton icon="close" variant="glass" label={t('common.close')} className="torrent-close" onClick={onClose} />
  ) : (
    <IconButton
      icon="chevron-left"
      variant="glass"
      label={t('torrent.back')}
      iconSize={24}
      className="torrent-back"
      onClick={goBack}
    />
  )

  if (data === null && offline) {
    return (
      <Root className={cx('torrent torrent-message', drawer && 'is-drawer')}>
        {backButton}
        <EmptyState
          icon="wifi-off"
          tone="error"
          title={t('offline.unreachableTitle')}
          actionLabel={t('common.retry')}
          onAction={refresh}
        >
          {t('offline.unreachableBody')}
        </EmptyState>
      </Root>
    )
  }

  if (data === null) {
    return (
      <Root className={cx('torrent', drawer && 'is-drawer')} aria-busy="true">
        {backButton}
        <div className="torrent-hero" />
        <div className="torrent-body" role="status">
          <span className="sr-only">{t('torrent.loading')}</span>
          <div className="torrent-head" aria-hidden="true">
            <div className="ks-skel torrent-poster torrent-skel-poster" />
            <div className="torrent-head-text">
              <div className="ks-skel" style={{ height: 22, width: '80%' }} />
              <div className="ks-skel" style={{ height: 12, width: '60%' }} />
            </div>
          </div>
          <div className="ks-skel torrent-skel-card" aria-hidden="true" />
        </div>
      </Root>
    )
  }

  if (!torrent) {
    return (
      <Root className={cx('torrent torrent-message', drawer && 'is-drawer')}>
        {backButton}
        <EmptyState
          icon="download"
          tone="muted"
          title={t('torrent.notFoundTitle')}
          actionLabel={drawer ? t('common.close') : t('torrent.backToDownloads')}
          onAction={drawer ? onClose : () => navigate('/')}
        >
          {t('torrent.notFoundBody')}
        </EmptyState>
        {/* A move or limits sent before the torrent went away still say how they went. */}
        {move.element}
        {limits.element}
      </Root>
    )
  }

  const status = downloadStatus(torrent)
  const running = isRunning(status)
  const downloading = status === 'downloading'
  const title = titleOf(torrent)
  const poster = match ? posterUrl(match.posterPath, 'w342') : undefined
  const locale = i18n.resolvedLanguage ?? i18n.language
  const ratio = torrent.ratio.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const hosts = trackers.data ? trackerHosts(trackers.data) : undefined

  // Busy while a pause or resume sent from anywhere (a row's button under the drawer) is in flight.
  const busy = pauseResume.busy(hash)
  const toggleRunning = () => void pauseResume.toggle(torrent)

  const guessed = !!match && isGuessed(torrent, stored)
  // The drawer is over this title's own page: going to the page is just closing the drawer.
  const page = behind !== undefined ? matchPath({ path: '/title/:type/:id', end: false }, behind) : null
  const onTitlePage =
    match && page?.params.type === match.type && page.params.id === String(match.id) ? onClose : undefined

  const confirmTitle = async () => {
    if (!match) return
    setSavingTitle(true)
    try {
      await chooseTitle(hash, match, language)
      titleSaved('confirmed')
    } catch {
      titleSaved('failed')
    } finally {
      setSavingTitle(false)
    }
  }

  const details: { key: string; label: string; value: string; mono?: boolean }[] = [
    { key: 'down', label: t('torrent.downloadSpeed'), value: downloading ? format.speed(torrent.dlspeed) : '—' },
    { key: 'up', label: t('torrent.uploadSpeed'), value: format.speed(torrent.upspeed) },
    ...(torrent.dl_limit > 0 ? [{ key: 'dl-limit', label: t('limits.downloadRow'), value: format.speed(torrent.dl_limit) }] : []),
    ...(torrent.up_limit > 0 ? [{ key: 'up-limit', label: t('limits.uploadRow'), value: format.speed(torrent.up_limit) }] : []),
    {
      key: 'peers',
      label: t('torrent.seedsPeers'),
      value: `${peerCount(torrent.num_seeds, torrent.num_complete)} · ${peerCount(torrent.num_leechs, torrent.num_incomplete)}`,
    },
    { key: 'ratio', label: t('torrent.ratio'), value: ratio },
    { key: 'path', label: t('torrent.savePath'), value: torrent.save_path, mono: true },
    { key: 'category', label: t('torrent.category'), value: torrent.category || '—' },
    {
      key: 'added',
      label: t('torrent.added'),
      value: torrent.added_on
        ? new Date(torrent.added_on * 1000).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
        : '—',
    },
    { key: 'hash', label: t('torrent.hash'), value: torrent.hash, mono: true },
    {
      key: 'trackers',
      label: t('torrent.trackers'),
      value: hosts ? hosts.join(', ') || '—' : trackers.error ? t('torrent.trackersFailed') : '…',
    },
  ]

  return (
    <Root className={cx('torrent', drawer && 'is-drawer')}>
      {backButton}
      <IconButton
        icon="more"
        variant="glass"
        label={t('downloads.moreActions', { name: title })}
        iconSize={22}
        className="torrent-more"
        aria-haspopup={drawer ? 'menu' : undefined}
        aria-expanded={drawer ? menuOpen !== null : undefined}
        onClick={(event) => {
          if (menuOpen && drawer) return closeMenu()
          setMenuAnchor(event.currentTarget)
          menu.open(hash)
        }}
      />
      <div className="torrent-hero" aria-hidden="true">
        {poster && <img src={poster} alt="" className="torrent-hero-art" />}
        <div className="torrent-hero-fade" />
      </div>
      <div className="torrent-body">
        <div className="torrent-head">
          <Poster src={poster} className="torrent-poster" />
          <div className="torrent-head-text">
            <Heading id={titleId} className="t-h2 torrent-title">
              {title}
            </Heading>
            {match && <p className="t-cap torrent-release c3">{torrent.name}</p>}
          </div>
        </div>

        {guessed && (
          <MatchPrompt kind="guess" busy={savingTitle} onChange={() => retitle.open(hash)} onConfirm={confirmTitle} />
        )}
        {match === null && <MatchPrompt kind="none" onChange={() => retitle.open(hash)} />}

        {offline && <OfflineBanner updatedAt={updatedAt} onRetry={refresh} />}

        <section className="ks-card torrent-card" aria-label={t('torrent.progressLabel')}>
          <div className="torrent-card-row">
            <StatusChip status={status}>{t(`status.${status}`)}</StatusChip>
            <span className="t-cap ks-num c2 torrent-size">
              {torrent.progress < 1
                ? `${format.size(torrent.size * torrent.progress)} / ${format.size(torrent.size)}`
                : format.size(torrent.size)}
            </span>
          </div>
          <div className="torrent-card-row torrent-pct-row">
            <span className="t-h1 ks-num torrent-pct">{format.percent(torrent.progress)}</span>
            {downloading && (
              <span className="t-label c2 ks-num">{t('torrent.eta', { eta: format.eta(torrent.eta) })}</span>
            )}
          </div>
          <ProgressBar
            value={torrent.progress}
            status={status}
            size="lg"
            label={t('downloads.progress', { name: title })}
          />
          <p className="t-cap ks-num c2 torrent-speeds">
            <span>
              <Icon name="arrow-down" size={14} />
              <span className="sr-only">{t('torrent.downloadSpeed')}</span>
              {downloading ? format.speed(torrent.dlspeed) : '—'}
            </span>
            <span>
              <Icon name="arrow-up" size={14} />
              <span className="sr-only">{t('torrent.uploadSpeed')}</span>
              {format.speed(torrent.upspeed)}
            </span>
            <span>{t('torrent.ratioValue', { ratio })}</span>
          </p>
          {status === 'error' && (
            <Banner tone="error">
              {torrent.state === 'missingFiles' ? t('torrent.missingFiles') : t('torrent.errorBody')}
            </Banner>
          )}
        </section>

        <div className="torrent-actions">
          {running ? (
            <Button variant="secondary" icon="pause" block loading={busy} disabled={offline || busy} onClick={toggleRunning}>
              {t('torrent.pause')}
            </Button>
          ) : (
            <Button variant="primary" icon="play" block loading={busy} disabled={offline || busy} onClick={toggleRunning}>
              {t('torrent.resume')}
            </Button>
          )}
          <Button variant="danger-ghost" icon="trash" block disabled={offline} onClick={() => confirm.open(hash)}>
            {t('torrent.delete')}
          </Button>
        </div>

        <section className="torrent-details">
          <h2 className="torrent-details-head">
            <button
              type="button"
              className="ks-acc-head"
              aria-expanded={detailsOpen}
              aria-controls="torrent-details-list"
              onClick={() => setDetailsOpen((open) => !open)}
            >
              {t('torrent.details')}
              <Icon name="chevron-down" size={20} />
            </button>
          </h2>
          {detailsOpen && (
            <dl id="torrent-details-list" className="torrent-kv">
              {details.map((row) => (
                <div key={row.key} className="ks-kv">
                  <dt>{row.label}</dt>
                  <dd className={row.mono ? 't-mono torrent-kv-long' : 'ks-num'}>{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <TorrentFiles hash={hash} status={status} disabled={offline} />
      </div>

      {confirm.torrent && (
        <DeleteTorrentDialog
          torrents={[torrent]}
          title={title}
          onClose={confirm.close}
          onDeleted={(withFiles) => {
            if (!onDeleted) return void navigate('/', { replace: true, state: { deleted: withFiles ? 'files' : 'torrent' } })
            // The page behind shows the torrents too, so it hears of the deletion right away.
            refresh()
            onDeleted()
          }}
        />
      )}

      {menuOpen && (
        <TorrentActionsSheet
          torrent={torrent}
          match={match}
          guessed={guessed}
          offline={offline}
          showDetails={false}
          anchor={menuOpen}
          onTitlePage={onTitlePage}
          onClose={closeMenu}
          onDelete={() => {
            closeMenu()
            confirm.open(hash)
          }}
          onMove={() => {
            closeMenu()
            move.open(torrent.hash)
          }}
          onRecheck={() => {
            closeMenu()
            recheck.open(hash)
          }}
          onSpeedLimits={() => {
            closeMenu()
            limits.open(torrent.hash)
          }}
          onReannounced={() => {
            closeMenu()
            toast.show(t('torrent.reannounced'))
          }}
          onChangeTitle={() => {
            closeMenu()
            retitle.open(hash)
          }}
          onConfirmed={() => {
            closeMenu()
            titleSaved('confirmed')
          }}
        />
      )}

      {move.element}
      {recheck.torrent && (
        <RecheckDialog
          hash={hash}
          title={title}
          onClose={recheck.close}
          onRechecked={() => {
            recheck.close()
            toast.show(t('torrent.rechecking'))
            refresh()
          }}
        />
      )}

      {limits.element}

      {retitle.torrent && (
        <ChangeTitleSheet
          torrent={torrent}
          current={match}
          onClose={retitle.close}
          onChosen={(result) => {
            retitle.close()
            titleSaved(result)
          }}
        />
      )}
    </Root>
  )
}
