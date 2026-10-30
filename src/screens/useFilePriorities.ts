import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { setFilePriority, type FilePriority, type Torrent, type TorrentFile } from '../api/qbittorrent'
import { useToast } from '../components/Toast'
import { REQUEST_KINDS } from '../torrents/requestKinds'
import { requestKey, type InFlight } from '../torrents/torrentRequests'
import type { TorrentFilesState } from '../torrents/useTorrentFiles'
import { useTorrentRequests } from '../torrents/useTorrentRequests'
import { TOAST_KEYS } from './toastKeys'

/** What a priority change sends. */
interface PriorityChange {
  index: number
  priority: FilePriority
}

/** What's being sent for a torrent's file, while it is. */
const pendingIn = (inFlight: InFlight, hash: string, index: number) =>
  inFlight.get(requestKey(REQUEST_KINDS.filePriority, hash, String(index))) as PriorityChange | undefined

/** A priority qBittorrent took for a file, shown until a poll sent at `after` or later says. */
interface Taken extends PriorityChange {
  after: number
}

export interface FilePriorities {
  /**
   * The torrent's files as the list shows them: what's being sent, else what qBittorrent took since
   * the poll was sent, else what the poll says.
   */
  files: TorrentFile[] | undefined
  /** Whether a change is in flight for the file, sent from anywhere. */
  busy: (index: number) => boolean
  /** The last change failed while this list showed the torrent. */
  failed: boolean
  /** Changes a file's priority, unless a change for it is in flight already. */
  set: (index: number, priority: FilePriority) => void
}

/**
 * A torrent's file priorities through the app's torrent requests, one change per file at a time
 * (`SendOptions.part`), so a list opened again while one is on its way shows it busy, with what's
 * being sent, and it never goes out twice. Once qBittorrent took it, the file keeps it until a poll
 * of `list` sent after the answer has the final word. A failure stays in the list that shows the
 * torrent, else it's a toast, which the next try takes back.
 */
export function useFilePriorities(torrent: Torrent, list: TorrentFilesState): FilePriorities {
  const { t } = useTranslation()
  const toast = useToast()
  const requests = useTorrentRequests()
  const inFlight = useSyncExternalStore(requests.subscribe, requests.getSnapshot)
  const [taken, setTaken] = useState<ReadonlyMap<number, Taken>>(new Map())
  const [failed, setFailed] = useState(false)

  // Read when a change settles, so it's the torrent shown then.
  const shown = useRef(torrent)
  useLayoutEffect(() => {
    shown.current = torrent
  })
  useEffect(
    () =>
      requests.watch(REQUEST_KINDS.filePriority, {
        shows: (target) => target.hash === shown.current.hash && target.added_on === shown.current.added_on,
        settled: (outcome, sent) => {
          if (!outcome.ok) return setFailed(true)
          const change = sent as PriorityChange
          setTaken((current) => new Map(current).set(change.index, { ...change, after: Date.now() }))
        },
      }),
    [requests],
  )

  const { hash } = torrent
  // Built again only when the poll, what's in flight or what qBittorrent took changes, so the list's
  // tree is too.
  const { files: polled, requestedAt } = list
  const files = useMemo(() => {
    if (polled === undefined) return undefined
    const priorityOf = (file: TorrentFile) => {
      const sending = pendingIn(inFlight, hash, file.index)
      if (sending) return sending.priority
      const kept = taken.get(file.index)
      // A poll sent at the same millisecond as the answer or later went out after qBittorrent took it.
      if (kept && requestedAt < kept.after) return kept.priority
      return file.priority
    }
    return polled.map((file) => {
      const priority = priorityOf(file)
      return priority === file.priority ? file : { ...file, priority }
    })
  }, [polled, requestedAt, inFlight, taken, hash])

  const set = async (index: number, priority: FilePriority) => {
    toast.dismiss(TOAST_KEYS.filePriority)
    setFailed(false)
    const settled = await requests.send(
      REQUEST_KINDS.filePriority,
      torrent,
      { index, priority } satisfies PriorityChange,
      () => setFilePriority(torrent.hash, [index], priority),
      { part: String(index) },
    )
    if (settled && !settled.ok && !settled.showing) {
      toast.show(t('torrent.priorityFailed'), { icon: 'alert', key: TOAST_KEYS.filePriority })
    }
  }

  return {
    files,
    busy: (index) => pendingIn(inFlight, hash, index) !== undefined,
    failed,
    set: (index, priority) => void set(index, priority),
  }
}
