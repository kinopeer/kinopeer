import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useParams } from 'react-router'
import {
  deleteTorrents,
  getTorrentTrackers,
  startTorrents,
  stopTorrents,
  type Torrent,
} from '../api/qbittorrent'
import { posterUrl } from '../api/tmdb'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Checkbox } from '../components/Checkbox'
import { Dialog } from '../components/Dialog'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { Poster } from '../components/Poster'
import { ProgressBar } from '../components/ProgressBar'
import { StatusChip } from '../components/StatusChip'
import { Toast } from '../components/Toast'
import { useFormatters } from '../lib/format'
import { useRequest } from '../lib/useRequest'
import { downloadStatus, type DownloadStatus } from '../torrents/status'
import { useTitleMatches } from '../torrents/titleMatches'
import { trackerHosts } from '../torrents/trackers'
import { useMainData } from '../torrents/useMainData'
import './TorrentScreen.css'

export interface TorrentScreenProps {
  /** qBittorrent rejected the session cookie (expired or signed out elsewhere). */
  onSessionLost: () => void
}

/** Statuses with something to stop; the rest get a Resume button. */
const RUNNING: DownloadStatus[] = ['downloading', 'seeding', 'queued', 'checking']

/** "12 (340)": connected, then in the swarm when a tracker reported it. */
function peerCount(connected: number, total: number | undefined): string {
  return total !== undefined && total >= 0 ? `${connected} (${total})` : String(connected)
}

export function TorrentScreen({ onSessionLost }: TorrentScreenProps) {
  const { t, i18n } = useTranslation()
  const format = useFormatters()
  const navigate = useNavigate()
  const location = useLocation()
  const { hash = '' } = useParams()
  const { data, offline, refresh } = useMainData(onSessionLost)
  const torrent: Torrent | undefined = data?.torrents[hash]

  const torrents = useMemo(() => (torrent ? [torrent] : []), [torrent])
  const match = useTitleMatches(torrents)[hash]

  const [detailsOpen, setDetailsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleteFiles, setDeleteFiles] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailed, setDeleteFailed] = useState(false)
  const dismissFailure = useCallback(() => setFailed(false), [])

  const trackers = useRequest(detailsOpen && torrent ? `trackers|${hash}` : null, () => getTorrentTrackers(hash))

  // Opened from inside the app: go back. Opened from a shared link: there's nothing to go back to.
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/'))
  const backButton = (
    <IconButton
      icon="chevron-left"
      variant="glass"
      label={t('torrent.back')}
      iconSize={24}
      className="torrent-back"
      onClick={goBack}
    />
  )

  if (data === null) {
    return (
      <main className="torrent" aria-busy="true">
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
      </main>
    )
  }

  if (!torrent) {
    return (
      <main className="torrent torrent-message">
        {backButton}
        <EmptyState
          icon="download"
          tone="muted"
          title={t('torrent.notFoundTitle')}
          actionLabel={t('torrent.backToDownloads')}
          onAction={() => navigate('/')}
        >
          {t('torrent.notFoundBody')}
        </EmptyState>
      </main>
    )
  }

  const status = downloadStatus(torrent)
  const running = RUNNING.includes(status)
  const downloading = status === 'downloading'
  const title = match?.title ?? torrent.name
  const poster = match ? posterUrl(match.posterPath, 'w342') : undefined
  const language = i18n.resolvedLanguage ?? i18n.language
  const ratio = torrent.ratio.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const hosts = trackers.data ? trackerHosts(trackers.data) : undefined

  const toggleRunning = async () => {
    setBusy(true)
    setFailed(false)
    try {
      await (running ? stopTorrents([hash]) : startTorrents([hash]))
      refresh()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    setDeleting(true)
    setDeleteFailed(false)
    try {
      await deleteTorrents([hash], deleteFiles)
      void navigate('/', { replace: true, state: { deleted: deleteFiles ? 'files' : 'torrent' } })
    } catch {
      setDeleteFailed(true)
      setDeleting(false)
    }
  }

  const openDelete = () => {
    setDeleteFiles(false)
    setDeleteFailed(false)
    setConfirming(true)
  }

  const details: { key: string; label: string; value: string; mono?: boolean }[] = [
    { key: 'down', label: t('torrent.downloadSpeed'), value: downloading ? format.speed(torrent.dlspeed) : '—' },
    { key: 'up', label: t('torrent.uploadSpeed'), value: format.speed(torrent.upspeed) },
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
        ? new Date(torrent.added_on * 1000).toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' })
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
    <main className="torrent">
      {backButton}
      <div className="torrent-hero" aria-hidden="true">
        {poster && <img src={poster} alt="" className="torrent-hero-art" />}
        <div className="torrent-hero-fade" />
      </div>
      <div className="torrent-body">
        <div className="torrent-head">
          <Poster src={poster} className="torrent-poster" />
          <div className="torrent-head-text">
            <h1 className="t-h2 torrent-title">{title}</h1>
            {match && <p className="torrent-release c3">{torrent.name}</p>}
          </div>
        </div>

        {offline && (
          <Banner tone="warning" title={t('downloads.offlineTitle')} actionLabel={t('common.retry')} onAction={refresh}>
            {t('torrent.offlineBody')}
          </Banner>
        )}

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
            <span className="ks-num torrent-pct">{format.percent(torrent.progress)}</span>
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
          <Button variant="danger-ghost" icon="trash" block disabled={offline} onClick={openDelete}>
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
      </div>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('torrent.deleteTitle')}
        icon="trash"
        tone="danger"
        actions={
          <>
            <Button variant="secondary" block onClick={() => setConfirming(false)}>
              {t('torrent.cancel')}
            </Button>
            <Button variant="danger" block loading={deleting} disabled={deleting} onClick={confirmDelete}>
              {t('torrent.delete')}
            </Button>
          </>
        }
      >
        <p className="t-body c2 torrent-delete-body">{t('torrent.deleteBody', { title })}</p>
        <div className="torrent-delete-files">
          <Checkbox
            id="torrent-delete-files"
            checked={deleteFiles}
            onChange={setDeleteFiles}
            label={t('torrent.deleteFiles', { size: format.size(torrent.size * torrent.progress) })}
            aria-describedby={deleteFiles ? 'torrent-delete-hint' : undefined}
          />
          <div className="torrent-delete-files-text">
            <label htmlFor="torrent-delete-files" className="t-label">
              {t('torrent.deleteFiles', { size: format.size(torrent.size * torrent.progress) })}
            </label>
            {deleteFiles && (
              <div id="torrent-delete-hint" className="c-err torrent-delete-hint">
                {t('torrent.deleteFilesHint')}
              </div>
            )}
          </div>
        </div>
        {deleteFailed && <Banner tone="error">{t('torrent.actionFailed')}</Banner>}
      </Dialog>

      {failed && <Toast icon="alert" message={t('torrent.actionFailed')} onDismiss={dismissFailure} />}
    </main>
  )
}
