import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { exportTorrent, getTorrentFiles, type Torrent, type TorrentFile } from '../api/qbittorrent'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { useRequest } from '../lib/useRequest'
import { originalNames, type FileRename, type MediaNames } from '../torrents/mediaNames'
import { filesTakenBy, namedPaths, placed, titleNames } from '../torrents/seriesNames'
import { readTorrentFile } from '../torrents/torrentFile'
import { notNamedText } from './notNamedText'
import './MediaNamesSheet.css'

/** How long after renames that failed the sheet reads the files again, so the ones qBittorrent took show. */
export const RENAMES_SETTLE_MS = 1000

/** What the sheet sends: the media server's names, or the original ones back. */
export type NamesMode = 'name' | 'restore'

export interface NamesChange {
  mode: NamesMode
  renames: FileRename[]
}

export interface MediaNamesSheetProps {
  torrent: Torrent
  type: 'movie' | 'tv'
  /** The movie or the series the torrent is matched to, in the app's TMDB language: the names are made of it. */
  title: string
  year?: number
  /** A movie's: another torrent in the folder naming would put this one's files in (`folderTakenBy`), by its name. Nothing is named then. None for a series. */
  taken?: string
  /** A series': the other torrents in the show's folder (`torrentsIn`), whose files the sheet reads and checks its own against (`filesTakenBy`). None for a movie. */
  neighbours: readonly Pick<Torrent, 'hash' | 'name' | 'save_path'>[]
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
  /** The neighbours' files, each `placed` under its torrent's save path; undefined for one whose files couldn't be read. */
  neighbours: { torrent: MediaNamesSheetProps['neighbours'][number]; files: string[] | undefined }[]
  /** The renames back to the metadata's names; undefined when the export couldn't be read. */
  original: FileRename[] | undefined
}

/**
 * The torrent's files and the original names from its own metadata (qBittorrent's export, whose info
 * hash covers the names it had before any rename). The export failing leaves naming as it is: only
 * the way back is missing, and the sheet says so.
 */
async function load(torrent: Torrent, neighbours: MediaNamesSheetProps['neighbours'], signal: AbortSignal): Promise<Loaded> {
  const [files, original, theirs] = await Promise.all([
    getTorrentFiles(torrent.hash, signal),
    exportTorrent(torrent.hash, signal)
      .then((bytes) => readTorrentFile(bytes))
      .catch(() => undefined),
    Promise.all(
      neighbours.map((other) =>
        getTorrentFiles(other.hash, signal).then(
          (listed) => ({ torrent: other, files: listed.map((file) => placed(other.save_path, file.name)) }),
          () => ({ torrent: other, files: undefined }),
        ),
      ),
    ),
  ])
  // Another torrent's metadata, or one that doesn't list these files, names nothing back.
  const meta = original?.infoHash === torrent.hash ? original : undefined
  return { files, neighbours: theirs, original: meta && originalNames(files, meta) }
}

/**
 * What naming does with the files loaded: the names, and the torrent in the way, a movie's from the
 * screen (`taken`), a series' found among its neighbours' files.
 */
function planNames(data: Loaded, torrent: Torrent, title: { type: 'movie' | 'tv'; title: string; year?: number }, takenFolder: string | undefined) {
  // A series' files in no folder of the torrent's read their season from its name.
  const names = titleNames(title, data.files, torrent.name)
  // Each torrent's files under its own save path, so a neighbour saved in the show's folder lines up.
  const named = names.named ? namedPaths(data.files, names.renames).map((path) => placed(torrent.save_path, path)) : undefined
  const taken = takenFolder ?? (named && filesTakenBy(named, data.neighbours)?.name)
  return { names, taken }
}

/**
 * "Name for a media server": what naming a movie's or a series' files would rename, old name over new, or why
 * they aren't named, and, for files whose names aren't the torrent's own, the way back to them.
 */
export function MediaNamesSheet({ torrent, type, title, year, taken: takenFolder, neighbours, offline, pending, failed, onSend, onClose }: MediaNamesSheetProps) {
  const { t } = useTranslation()
  // A neighbour's files are placed under its save path as they load: one moved loads them again.
  const around = neighbours.map((other) => `${other.hash}@${other.save_path}`).join('|')
  const loaded = useRequest(`qbt|names|${torrent.hash}|${around}`, (signal) => load(torrent, neighbours, signal))
  // Opened while a restore is in flight, it shows the restore, as the sheet that sent it did.
  const [mode, setMode] = useState<NamesMode>(pending?.mode ?? 'name')
  const sending = pending !== undefined
  // Renames that failed may have renamed some files first: the list shows the names qBittorrent has
  // now, read once it has applied them, which it does a moment after answering (`renameFiles`).
  const { retry } = loaded
  useEffect(() => {
    if (!failed) return
    const timer = setTimeout(retry, RENAMES_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [failed, retry])
  const data = loaded.data
  const plan = data && planNames(data, torrent, { type, title, year }, takenFolder)
  const names = plan?.names
  const taken = plan?.taken
  const restore = data?.original?.length ? data.original : undefined
  // What's being sent is what the sheet shows, whatever the files' names read now.
  const renames = pending ? pending.renames : mode === 'restore' ? (restore ?? []) : names?.named && !taken ? names.renames : []

  const footer = data && (
    <div className="names-stack">
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
        {/* While renames are on their way, the sheet shows them, not names qBittorrent may have half applied. */}
        {data && (pending || mode === 'restore') && <RenamesList renames={renames} />}
        {data && !pending && mode === 'name' && names && <NamesPreview type={type} names={names} taken={taken} />}
        {data && mode === 'name' && data.original === undefined && <p className="t-cap c3">{t('names.originalUnread')}</p>}
        {failed && <Banner tone="error">{t('names.failed')}</Banner>}
      </div>
    </Sheet>
  )
}

/** What naming does: the folder, then each file whose own name changes; or why nothing is named. */
function NamesPreview({ type, names, taken }: { type: 'movie' | 'tv'; names: MediaNames; taken?: string }) {
  const { t } = useTranslation()
  const id = useId()
  if (!names.named) {
    return <Banner tone="info" title={t('names.notNamed')}>{notNamedText(names.reason, t)}</Banner>
  }
  if (!names.renames.length) return <Banner tone="info" icon="check-circle" title={t('names.already')} />
  if (taken) {
    return (
      <Banner tone="info" title={t('names.notNamed')}>
        {t(type === 'movie' ? 'names.taken' : 'names.takenFiles', { folder: names.folder.to, name: taken })}
      </Banner>
    )
  }
  const { folder, files, unread = [] } = names
  return (
    <>
      <section className="names-stack" aria-labelledby={`${id}-folder`}>
        <h3 id={`${id}-folder`} className="ks-label">
          {t('common.folder')}
        </h3>
        <Rename from={folder.from} to={folder.to} />
      </section>
      {files.length > 0 && (
        <section className="names-stack" aria-labelledby={`${id}-files`}>
          <h3 id={`${id}-files`} className="ks-label">
            {t('torrent.files')}
          </h3>
          <RenamesList renames={files} />
        </section>
      )}
      {unread.length > 0 && (
        <section className="names-stack" aria-labelledby={`${id}-unread`}>
          <h3 id={`${id}-unread`} className="ks-label">
            {t('names.unread')}
          </h3>
          <ul className="names-stack names-list">
            {unread.map((path) => (
              <li key={path} className="t-mono c3 names-from">
                {path}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="t-cap c2">{type === 'movie' ? t('names.others') : t('names.othersSeries')}</p>
    </>
  )
}

/** Renames, each old over new: the files naming renames, or every file the way back renames, by its whole path. */
function RenamesList({ renames }: { renames: FileRename[] }) {
  return (
    <ul className="names-stack names-list">
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
