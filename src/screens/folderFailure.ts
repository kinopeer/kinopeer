import { QbittorrentError, UnauthorizedError } from '../api/qbittorrent'

/** Why qBittorrent didn't take a folder, as a translation key. */
export type FolderFailure = 'move.noAccess' | 'move.cantCreate' | 'common.qbtFailed'

/** Why qBittorrent didn't take a folder: what Move files and Settings' folders say about a failure. */
export function folderFailure(error: unknown): FolderFailure {
  if (error instanceof QbittorrentError && !(error instanceof UnauthorizedError)) {
    if (error.status === 403) return 'move.noAccess'
    if (error.status === 409) return 'move.cantCreate'
  }
  // A lost session included: the screen's poll notices it and asks for the login.
  return 'common.qbtFailed'
}
