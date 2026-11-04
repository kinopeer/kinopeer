import type { SaveLocations, Torrent } from '../api/qbittorrent'
import { categoryFolder, sameFolder } from './folders'

/**
 * What qBittorrent does with a torrent's files when its category changes (`TorrentImpl::setCategory`
 * in qBittorrent 5.3):
 * - `move`: under automatic management, the files move to the new category's folder;
 * - `stay`: under automatic management, the new category's folder is the one they're in already;
 * - `toManual`: under automatic management, qBittorrent's preferences say not to relocate, so it
 *   turns automatic management off and the files stay where they are;
 * - `manual`: the torrent is in manual mode, so the category is only a label and nothing moves.
 *
 * `folder` is where the files are afterwards, empty when that can't be known (qBittorrent's default
 * save path didn't load, or an incomplete torrent goes to a download path).
 */
export type CategoryChange = { kind: 'move' | 'stay' | 'toManual' | 'manual'; folder: string }

/** What changing `torrent`'s category to `category` (empty for none) does with its files. */
/** Whether qBittorrent keeps a category's incomplete torrents in a download path of their own. */
function keepsIncomplete(category: string, locations: SaveLocations): boolean {
  const own = locations.categories.find((item) => item.name === category)?.download_path
  // A path, empty for qBittorrent's default one (`CategoryOptions::toJSON`); false for none; else
  // qBittorrent's own setting.
  if (typeof own === 'string') return true
  return own === false ? false : locations.downloadPath
}

export function categoryChange(
  torrent: Pick<Torrent, 'auto_tmm' | 'save_path' | 'progress'>,
  category: string,
  locations: SaveLocations,
): CategoryChange {
  if (!torrent.auto_tmm) return { kind: 'manual', folder: torrent.save_path }
  if (!locations.relocateOnCategoryChange) return { kind: 'toManual', folder: torrent.save_path }
  // An incomplete torrent goes to the category's download path instead (`categoryDownloadPath`),
  // which Kinoseed doesn't place: the files move, to a folder it doesn't name.
  if (torrent.progress < 1 && keepsIncomplete(category, locations)) return { kind: 'move', folder: '' }
  // Without a category, qBittorrent's categorySavePath is the default save path itself.
  const folder = category ? categoryFolder(category, locations) : locations.defaultPath
  if (folder && sameFolder(folder) === sameFolder(torrent.save_path)) return { kind: 'stay', folder: torrent.save_path }
  return { kind: 'move', folder }
}

/**
 * The torrent as qBittorrent reports it once it took the new category: the next poll already has the
 * new folder of a torrent that moves (and the state `moving` while the files go there), or automatic
 * management off.
 */
export function withCategory(torrent: Torrent, category: string, change: CategoryChange): Torrent {
  const next = { ...torrent, category }
  // Where the files are afterwards: the new folder of a move, else the one they're in.
  if (change.folder) next.save_path = change.folder
  if (change.kind === 'toManual') next.auto_tmm = false
  return next
}
