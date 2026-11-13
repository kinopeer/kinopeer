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
  /** Sequential download, on or off: the switch on the torrent's page. */
  sequential: 'sequential',
  /** First and last pieces first, on or off: the switch on the torrent's page. */
  firstLastPieces: 'first-last-pieces',
  /** A torrent's category: the Category sheet. */
  category: 'category',
  /** Saving the torrent's title: the title search (Fix match, or Match title for a torrent without one). */
  title: 'title',
  /**
   * A file's download priority: the torrent's file list, one per file (`SendOptions.part`). Keyed
   * with the file, so a check for the torrent alone (`requestKey(kind, hash)`) never sees them: one
   * that means "anything in flight for this torrent" has to look for parts too.
   */
  filePriority: 'file-priority',
} as const

export type RequestKind = (typeof REQUEST_KINDS)[keyof typeof REQUEST_KINDS]
