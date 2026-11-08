import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { startTorrents, stopTorrents, type Torrent } from '../api/qbittorrent'
import { useToast } from '../components/Toast'
import { REQUEST_KINDS } from '../torrents/requestKinds'
import { readRefreshInterval, stateLag } from '../torrents/stateLag'
import { downloadStatus, isRunning, withRunning } from '../torrents/status'
import type { Settled } from '../torrents/torrentRequests'
import { TOAST_KEYS } from './toastKeys'
import { useTorrentAction, type ActionWatcher } from './useTorrentAction'

export interface PauseResume {
  /** Whether a pause or resume is in flight for the torrent, sent from anywhere. */
  busy: (hash: string) => boolean
  /**
   * Pauses the torrents, or resumes them, in one request, without those with one in flight. Once
   * qBittorrent took it they show their new state until it reports theirs (`stateLag`); a failure
   * nothing showing them took is a toast.
   */
  set: (targets: readonly Torrent[], running: boolean) => Promise<Settled | undefined>
  /** Pauses a running torrent, resumes the others. */
  toggle: (torrent: Torrent) => Promise<Settled | undefined>
}

/**
 * Pausing and resuming through the app's torrent requests (`useTorrentAction`), so each place that
 * shows a torrent shows its pause or resume busy, wherever it was sent from, and it never goes out
 * twice. A failure is a toast, which the next try takes back, unless `watcher` shows the torrent and
 * takes the outcome itself.
 */
export function usePauseResume(watcher?: ActionWatcher): PauseResume {
  const { t } = useTranslation()
  const toast = useToast()
  const { busy, send } = useTorrentAction(REQUEST_KINDS.pauseResume, watcher)

  const set = useCallback(
    async (targets: readonly Torrent[], running: boolean) => {
      toast.dismiss(TOAST_KEYS.pauseResume)
      // Alongside the request, so qBittorrent's interval is usually known by the time it answers;
      // if not, its default holds this one.
      void readRefreshInterval()
      const settled = await send(
        targets,
        running,
        (hashes) => (running ? startTorrents(hashes) : stopTorrents(hashes)),
        // qBittorrent reports the new state only once it updates the states, so the polls until
        // then don't undo it.
        { expect: (torrent) => withRunning(torrent, running), hold: stateLag },
      )
      if (settled && !settled.ok && !settled.showing) {
        toast.show(t('common.qbtFailed'), { icon: 'alert', key: TOAST_KEYS.pauseResume })
      }
      return settled
    },
    [send, toast, t],
  )

  // The same function from render to render, so Downloads' memoized rows can take it.
  const toggle = useCallback(
    (torrent: Torrent) => set([torrent], !isRunning(downloadStatus(torrent))),
    [set],
  )
  return { busy, set, toggle }
}
