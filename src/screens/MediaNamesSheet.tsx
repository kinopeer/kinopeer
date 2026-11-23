import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { exportTorrent, getTorrentFiles, type Torrent, type TorrentFile } from '../api/qbittorrent'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { Sheet } from '../components/Sheet'
import { useRequest } from '../lib/useRequest'
import { movieNames, originalNames, type FileRename, type MediaNames } from '../torrents/mediaNames'
import { readTorrentFile } from '../torrents/torrentFile'
import './MediaNamesSheet.css'

/** What the sheet sends: the media server's names, or the original ones back. */
export type NamesMode = 'name' | 'restore'

export interface NamesChange {
  mode: NamesMode
  renames: FileRename[]
}

export interface MediaNamesSheetProps {
  torrent: Torrent
  /** The movie the torrent is matched to, in the app's TMDB language: the names are made of it. */
  title: string
  year?: number
  /** qBittorrent is unreachable: nothing can be sent. */
  offline: boolean
  /** What's being sent for this torrent, from this sheet or one closed before it opened. */
  pending?: NamesChange
  /** The last renames sent weren't all taken. */
  failed: boolean
  onSend: (change: NamesChange) => void
  onClose: () => void
}

interface Loaded {
  files: TorrentFile[]
  /** The renames back to the metadata's names; undefined when the export couldn't be read. */
  original: FileRename[] | undefined
}

/**
 * The torrent's files and the original names from its own metadata (qBittorrent's export, whose info
 * hash covers the names it had before any rename). The export failing leaves naming as it is: only
 * the way back is missing, and the sheet says so.
 */
async function load(torrent: Torrent, signal: AbortSignal): Promise<Loaded> {
  const [files, original] = await Promise.all([
    getTorrentFiles(torrent.hash, signal),
    exportTorrent(torrent.hash, signal)
      .then((bytes) => readTorrentFile(bytes))
      .catch(() => undefined),
  ])
  // Another torrent's metadata, or one that doesn't list these files, names nothing back.
  const meta = original?.infoHash === torrent.hash ? original : undefined
  return { files, original: meta && originalNames(files, meta) }
}

/**
 * "Name for a media server": what naming a movie's files would rename, old name over new, or why
 * they aren't named, and, for files whose names aren't the torrent's own, the way back to them.
 */
export function MediaNamesSheet({ torrent, title, year, offline, pending, failed, onSend, onClose }: MediaNamesSheetProps) {
  const { t } = useTranslation()
  const loaded = useRequest(`qbt|names|${torrent.hash}`, (signal) => load(torrent, signal))
  // Opened while a restore is in flight, it shows the restore, as the sheet that sent it did.
  const [mode, setMode] = useState<NamesMode>(pending?.mode ?? 'name')
  const sending = pending !== undefined
  // Renames that failed may have renamed some files first: the list shows the names qBittorrent has now.
  const { retry } = loaded
  useEffect(() => {
    if (failed) retry()
  }, [failed, retry])
  const data = loaded.data
  const names = data && movieNames(data.files, title, year)
  const restore = data?.original?.length ? data.original : undefined
  const renames = mode === 'restore' ? (restore ?? []) : names?.named ? names.renames : []

  const footer = data && (
    <div className="names-foot">
      {renames.length > 0 && (
        <Button variant="primary" size="lg" block loading={sending} disabled={sending || offline} onClick={() => onSend({ mode, renames })}>
          {mode === 'restore' ? t('names.restore') : t('names.rename')}
        </Button>
      )}
      {mode === 'name' && restore && (
        <Button variant="ghost" size="lg" block disabled={sending} onClick={() => setMode('restore')}>
          {t('names.restoreOriginal')}
        </Button>
      )}
      {mode === 'restore' && (
        <Button variant="ghost" size="lg" block disabled={sending} onClick={() => setMode('name')}>
          {t('common.back')}
        </Button>
      )}
    </div>
  )

  return (
    <Sheet
      open
      onClose={onClose}
      title={mode === 'restore' ? t('names.restoreOriginal') : t('names.title')}
      subtitle={torrent.name}
      action={<IconButton icon="close" label={t('common.cancel')} onClick={onClose} />}
      footer={footer}
    >
      <div className="names-body">
        {loaded.loading && (
          <div className="names-row" role="status">
            <span className="ks-spin ca" />
            <span className="c2">{t('names.loading')}</span>
          </div>
        )}
        {loaded.error !== undefined && (
          <Banner tone="error" actionLabel={t('common.retry')} onAction={loaded.retry}>
            {t('common.qbtFailed')}
          </Banner>
        )}
        {data && mode === 'name' && names && <NamesPreview names={names} />}
        {data && mode === 'restore' && <RenamesList renames={renames} />}
        {data && mode === 'name' && data.original === undefined && <p className="t-cap c3">{t('names.originalUnread')}</p>}
        {failed && <Banner tone="error">{t('names.failed')}</Banner>}
      </div>
    </Sheet>
  )
}

/** What naming does: the folder, then each file whose own name changes; or why nothing is named. */
function NamesPreview({ names }: { names: MediaNames }) {
  const { t } = useTranslation()
  const id = useId()
  if (!names.named) {
    const reason = { 'no-video': t('names.noVideo'), 'several-videos': t('names.severalVideos'), disc: t('names.disc') }[names.reason]
    return <Banner tone="info" title={t('names.notNamed')}>{reason}</Banner>
  }
  if (!names.renames.length) return <Banner tone="info" icon="check-circle" title={t('names.already')} />
  const { folder, files } = names
  return (
    <>
      <section className="names-group" aria-labelledby={`${id}-folder`}>
        <h3 id={`${id}-folder`} className="ks-label">
          {t('common.folder')}
        </h3>
        <Rename from={folder.from} to={folder.to} />
      </section>
      {files.length > 0 && (
        <section className="names-group" aria-labelledby={`${id}-files`}>
          <h3 id={`${id}-files`} className="ks-label">
            {t('names.files')}
          </h3>
          <ul className="names-list">
            {files.map((file) => (
              <li key={file.from}>
                <Rename from={file.from} to={file.to} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="t-cap c2">{t('names.others')}</p>
    </>
  )
}

/** Every rename by its whole path, as the way back changes folders as well as names. */
function RenamesList({ renames }: { renames: FileRename[] }) {
  return (
    <ul className="names-list">
      {renames.map((rename) => (
        <li key={rename.from}>
          <Rename from={rename.from} to={rename.to} />
        </li>
      ))}
    </ul>
  )
}

/** One name and what it becomes; without an old one, a folder that naming makes. */
function Rename({ from, to }: { from?: string; to: string }) {
  const { t } = useTranslation()
  return (
    <div className="names-rename">
      <span className="t-mono c3 names-from">{from ?? t('names.newFolder')}</span>
      <span className="t-mono names-to">
        <Icon name="arrow-down" size={14} className="ca names-arrow" />
        <span className="sr-only">{t('names.becomes')} </span>
        {to}
      </span>
    </div>
  )
}
