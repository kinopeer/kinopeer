import { QbittorrentError, unreachable } from '../api/qbittorrent'
import { unreachableText } from '../lib/unreachable'

/** Why qBittorrent didn't take a folder, as a translation key. */
export type FolderFailure = 'move.cantCreate' | 'folders.categoryGone' | 'common.qbtFailed' | 'common.qbtFailed_kinopeer'

/** Why qBittorrent didn't take a folder: what Move files and Settings' folders say about a failure. */
export function folderFailure(error: unknown): FolderFailure {
  if (error instanceof QbittorrentError && error.status === 409) return 'move.cantCreate'
  // A lost session included: the screen's poll notices it and asks for the login.
  return unreachableText(unreachable(error)) === 'kinopeer' ? 'common.qbtFailed_kinopeer' : 'common.qbtFailed'
}

/**
 * Why qBittorrent didn't take a category's folder: the category is gone (409 before 5.2, 404 from
 * it), else as `folderFailure` says. Its folder was made by then, so a 409 here isn't that.
 */
export function categoryFailure(error: unknown): FolderFailure {
  if (error instanceof QbittorrentError && (error.status === 409 || error.status === 404)) return 'folders.categoryGone'
  return folderFailure(error)
}
