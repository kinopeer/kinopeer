import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { startTorrents, stopTorrents, type Torrent } from '../api/qbittorrent'
import { useToast } from '../components/Toast'
import { downloadStatus, isRunning, withRunning } from '../torrents/status'
import { requestKey, type Outcome, type Settled } from '../torrents/torrentRequests'
import { useTorrentRequests } from '../torrents/useTorrentRequests'
import { TOAST_KEYS } from './toastKeys'

/** The requests' kind for pausing and resuming: one at a time per torrent, whichever it is. */
export const PAUSE_RESUME = 'pause-resume'

export interface PauseResume {
  /** Whether a pause or resume is in flight for the torrent, sent from anywhere. */
  busy: (hash: string) => boolean
  /**
   * Pauses the torrents, or resumes them, in one request, without those with one in flight. Once
   * qBittorrent took it they show their new state; a failure nothing showing them took is a toast.
   */
  set: (targets: readonly Torrent[], running: boolean) => Promise<Settled | undefined>
  /** Pauses a running torrent, resumes the others. */
  toggle: (torrent: Torrent) => Promise<Settled | undefined>
}

/** Something that shows one torrent and says itself how its pause or resume went (the More menu). */
export interface PauseResumeWatcher {
  torrent: Torrent
  settled: (outcome: Outcome) => void
}

/**
 * Pausing and resuming through the app's torrent requests (`useTorrentRequests`), so each place that
 * shows a torrent shows its pause or resume busy, wherever it was sent from, and it never goes out
 * twice. A failure is a toast, which the next try takes back, unless `watcher` shows the torrent and
 * takes the outcome itself.
 */
export function usePauseResume(watcher?: PauseResumeWatcher): PauseResume {
  const { t } = useTranslation()
  const toast = useToast()
  const requests = useTorrentRequests()
  const inFlight = useSyncExternalStore(requests.subscribe, requests.getSnapshot)

  // Read when a request settles, so it's whatever the watcher shows then.
  const shown = useRef(watcher)
  useLayoutEffect(() => {
    shown.current = watcher
  })
  const watching = watcher !== undefined
  useEffect(() => {
    if (!watching) return
    return requests.watch(PAUSE_RESUME, {
      shows: (target) => shown.current?.torrent.hash === target.hash && shown.current.torrent.added_on === target.added_on,
      settled: (outcome) => shown.current?.settled(outcome),
    })
  }, [requests, watching])

  const set = useCallback(
    async (targets: readonly Torrent[], running: boolean) => {
      toast.dismiss(TOAST_KEYS.pauseResume)
      const settled = await requests.send(
        PAUSE_RESUME,
        targets,
        running,
        (hashes) => (running ? startTorrents(hashes) : stopTorrents(hashes)),
        { expect: (torrent) => withRunning(torrent, running) },
      )
      if (settled && !settled.ok && !settled.showing) {
        toast.show(t('torrent.actionFailed'), { icon: 'alert', key: TOAST_KEYS.pauseResume })
      }
      return settled
    },
    [requests, toast, t],
  )

  return {
    busy: (hash) => inFlight.has(requestKey(PAUSE_RESUME, hash)),
    set,
    toggle: (torrent) => set([torrent], !isRunning(downloadStatus(torrent))),
  }
}
