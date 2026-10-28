import type { ReleaseSource } from '../api/prowlarr'
import {
  QbittorrentError,
  addTorrents,
  getTorrentFiles,
  setFilePriority,
  startTorrents,
  type TorrentFile,
} from '../api/qbittorrent'
import type { TorrentMeta } from '../torrents/torrentFile'

export interface AddReleaseOptions {
  tags: string[]
  category?: string
  savePath?: string
  paused: boolean
  sequential: boolean
  firstLastPieces: boolean
  topOfQueue: boolean
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
 * Sends a release to qBittorrent. With files to skip, it adds the torrent stopped, sets those files
 * to "do not download" and then starts it (unless it should stay paused), so nothing unwanted
 * downloads in between.
 */
export async function addRelease(
  source: ReleaseSource,
  options: AddReleaseOptions,
  selection?: FileSelection,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<void> {
  const partial = !!selection?.skip.length
  await addTorrents({
    ...(source.kind === 'torrent' ? { files: [source.file] } : { urls: [source.uri] }),
    tags: options.tags,
    category: options.category,
    savePath: options.savePath,
    stopped: partial || options.paused,
    sequentialDownload: options.sequential,
    firstLastPiecePrio: options.firstLastPieces,
    addToTopOfQueue: options.topOfQueue,
  })
  if (!partial) return

  const hash = selection.meta.infoHash
  const files = await filesOf(hash, wait)
  await setFilePriority(hash, skippedIds(selection, files), 0)
  if (!options.paused) await startTorrents([hash])
}
