/**
 * The kinds of the app's torrent requests (`createTorrentRequests`): one of a kind per torrent in
 * flight at a time, so each place that sends a kind or shows it busy names it the same.
 */
export const REQUEST_KINDS = {
  /** Moving a torrent's files: the Move files sheet. */
  move: 'move',
  /** A torrent's own speed limits: the Speed limits sheet. */
  limits: 'limits',
  /** Pausing and resuming, whichever it is. */
  pauseResume: 'pause-resume',
  reannounce: 'reannounce',
  /** A forced recheck: its confirmation. */
  recheck: 'recheck',
  /** Deleting torrents, with their files or without: its confirmation. */
  delete: 'delete',
  /** Saving the torrent's title: Change title, or "Yes, right" for a guessed one. */
  title: 'title',
  /** A file's download priority: the torrent's file list, one per file (`SendOptions.part`). */
  filePriority: 'file-priority',
} as const

export type RequestKind = (typeof REQUEST_KINDS)[keyof typeof REQUEST_KINDS]
