import type { ReleaseSource } from '../api/prowlarr'
import {
  QbittorrentError,
  addTorrents,
  getTorrentFiles,
  getTorrents,
  renameFiles,
  setFilePriority,
  startTorrents,
  type TorrentFile,
} from '../api/qbittorrent'
import { folderTakenBy, movieNames } from '../torrents/mediaNames'
import type { TorrentMeta } from '../torrents/torrentFile'

export interface AddReleaseOptions {
  tags: string[]
  category?: string
  savePath?: string
  paused: boolean
  sequential: boolean
  firstLastPieces: boolean
  topOfQueue: boolean
  /** Name the movie's files for a media server (`movieNames`) once added; needs the torrent's files (`FileSelection`). */
  mediaNames?: { title: string; year?: number }
}

/**
 * The torrent was added, but its files weren't named for a media server: `taken` when another torrent
 * is in the folder naming would use (`folderTakenBy`), else `cause` says why it failed.
 */
export class MediaNamesError extends Error {
  readonly taken?: { name: string; folder: string }
  constructor(cause: unknown, taken?: { name: string; folder: string }) {
    super('The torrent was added, but its files were not named', { cause })
    this.name = 'MediaNamesError'
    this.taken = taken
  }
}

/** Files to leave out, as indexes into `meta.files`. */
export interface FileSelection {
  meta: TorrentMeta
  skip: number[]
}

const FILES_ATTEMPTS = 20
const FILES_INTERVAL_MS = 250

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** qBittorrent lists a torrent's files a moment after adding it. */
async function filesOf(hash: string, wait: (ms: number) => Promise<void>): Promise<TorrentFile[]> {
  for (let attempt = 0; attempt < FILES_ATTEMPTS; attempt++) {
    try {
      const files = await getTorrentFiles(hash)
      if (files.length) return files
    } catch (error) {
      if (!(error instanceof QbittorrentError && error.status === 404)) throw error
    }
    await wait(FILES_INTERVAL_MS)
  }
  throw new QbittorrentError('qBittorrent did not list the torrent’s files', 504)
}

/**
 * qBittorrent's file indexes for the skipped files. Its names include the torrent's folder (or not,
 * depending on its content layout setting), so files are matched by their path inside the torrent.
 */
function skippedIds(selection: FileSelection, files: TorrentFile[]): number[] {
  const { meta, skip } = selection
  return skip.flatMap((index) => {
    const { path } = meta.files[index]
    const match = files.find((file) => file.name === path || file.name.endsWith(`/${path}`))
    if (match) return [match.index]
    return files.length === meta.files.length ? [files[index].index] : []
  })
}

/**
 * Sends a release to qBittorrent. With files to skip or to name, it adds the torrent stopped, sets
 * those files to "do not download" and names the movie's files for a media server, then starts it
 * (unless it should stay paused), so nothing unwanted downloads in between and nothing downloads
 * under the release's names. A torrent whose files aren't named (`movieNames` says why) is added as
 * it is; when the renames fail it's started all the same and `MediaNamesError` says so.
 */
export async function addRelease(
  source: ReleaseSource,
  options: AddReleaseOptions,
  selection?: FileSelection,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<void> {
  const partial = !!selection?.skip.length
  const naming = !!selection && !!options.mediaNames
  await addTorrents({
    ...(source.kind === 'torrent' ? { files: [source.file] } : { urls: [source.uri] }),
    tags: options.tags,
    category: options.category,
    savePath: options.savePath,
    stopped: partial || naming || options.paused,
    sequentialDownload: options.sequential,
    firstLastPiecePrio: options.firstLastPieces,
    addToTopOfQueue: options.topOfQueue,
  })
  if (!selection || !(partial || naming)) return

  const hash = selection.meta.infoHash
  let files: TorrentFile[] | undefined
  if (partial) {
    files = await filesOf(hash, wait)
    await setFilePriority(hash, skippedIds(selection, files), 0)
  }
  let failure: MediaNamesError | undefined
  if (options.mediaNames) {
    // Naming alone stopped a torrent that would have started at once: whatever fails here, it starts.
    try {
      const names = movieNames(files ?? (await filesOf(hash, wait)), options.mediaNames.title, options.mediaNames.year)
      if (names.named && names.renames.length) {
        // Where qBittorrent put it, and whether another torrent is in the folder naming would use there.
        const torrents = await getTorrents()
        const own = torrents.find((torrent) => torrent.hash === hash)
        if (!own) throw new QbittorrentError('qBittorrent did not list the torrent', 404)
        const other = folderTakenBy(torrents, own, names.folder.to)
        if (other) failure = new MediaNamesError(undefined, { name: other.name, folder: names.folder.to })
        else await renameFiles(hash, names.renames)
      }
    } catch (error) {
      failure = new MediaNamesError(error)
    }
  }
  if (!options.paused) await startTorrents([hash])
  if (failure) throw failure
}
