/**
 * Keys of failure toasts said in more than one place, so trying the action again anywhere takes the
 * failure back (`useToast().dismiss`) rather than leaving it up for its full time.
 */
export const TOAST_KEYS = {
  /** Pausing or resuming torrents: a row's button, the torrent's details, the selection's bar. */
  pauseResume: 'pause-resume-failed',
  /** Reannouncing: the More menu on any screen. */
  reannounce: 'reannounce-failed',
  /** A forced recheck: the confirmation on any screen. */
  recheck: 'recheck-failed',
  /** Deleting torrents: the confirmation for a row, the selection or the torrent's details. */
  delete: 'delete-failed',
  /** Switching the alternative speed limits. */
  altSpeed: 'alt-speed-failed',
} as const
