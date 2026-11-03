import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { setFilePriority, type FilePriority, type Torrent, type TorrentFile } from '../api/qbittorrent'
import { useToast } from '../components/Toast'
import { REQUEST_KINDS } from '../torrents/requestKinds'
import { inFlightParts, type InFlight } from '../torrents/torrentRequests'
import type { TorrentFilesState } from '../torrents/useTorrentFiles'
import { useTorrentRequests } from '../torrents/useTorrentRequests'
import { TOAST_KEYS } from './toastKeys'

/** What a priority change sends: one file's, or every file's in a folder. */
interface PriorityChange {
  indexes: readonly number[]
  priority: FilePriority
}

/** The priority being sent for each of a torrent's files that has one on its way, from any change. */
function sendingIn(inFlight: InFlight, hash: string): ReadonlyMap<number, FilePriority> {
  const sending = new Map<number, FilePriority>()
  for (const change of inFlightParts(inFlight, REQUEST_KINDS.filePriority, hash) as PriorityChange[]) {
    change.indexes.forEach((index) => sending.set(index, change.priority))
  }
  return sending
}

/** A priority qBittorrent took for a file, shown until a poll sent at `after` or later says. */
interface Taken {
  priority: FilePriority
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
  /**
   * Changes the priority of files (one, or a folder's) in one request, unless one of them has a
   * change in flight already: then nothing is sent, so two changes never race for a file.
   */
  set: (indexes: readonly number[], priority: FilePriority) => void
}

/**
 * A torrent's file priorities through the app's torrent requests, one change per file at a time
 * (`SendOptions.part`, the files' indexes; a folder's change is one request for its files), so a list opened again while one is on its way shows it busy, with what's
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
          const { indexes, priority } = sent as PriorityChange
          const after = Date.now()
          setTaken((current) => {
            const next = new Map(current)
            indexes.forEach((index) => next.set(index, { priority, after }))
            return next
          })
        },
      }),
    [requests],
  )

  const { hash } = torrent
  // Built again only when the poll, what's in flight or what qBittorrent took changes, so the list's
  // tree is too.
  const { files: polled, requestedAt } = list
  const sending = useMemo(() => sendingIn(inFlight, hash), [inFlight, hash])
  const files = useMemo(() => {
    if (polled === undefined) return undefined
    const priorityOf = (file: TorrentFile) => {
      const priority = sending.get(file.index)
      if (priority !== undefined) return priority
      const kept = taken.get(file.index)
      // A poll sent at the same millisecond as the answer or later went out after qBittorrent took it.
      if (kept && requestedAt < kept.after) return kept.priority
      return file.priority
    }
    return polled.map((file) => {
      const priority = priorityOf(file)
      return priority === file.priority ? file : { ...file, priority }
    })
  }, [polled, requestedAt, sending, taken])

  const set = async (indexes: readonly number[], priority: FilePriority) => {
    // Read from the store, not this render: another list may have sent one a moment ago.
    const busy = sendingIn(requests.getSnapshot(), hash)
    if (indexes.some((index) => busy.has(index))) return
    toast.dismiss(TOAST_KEYS.filePriority)
    setFailed(false)
    const settled = await requests.send(
      REQUEST_KINDS.filePriority,
      torrent,
      { indexes, priority } satisfies PriorityChange,
      () => setFilePriority(torrent.hash, indexes, priority),
      { part: indexes.join() },
    )
    if (settled && !settled.ok && !settled.showing) {
      toast.show(t('torrent.priorityFailed'), { icon: 'alert', key: TOAST_KEYS.filePriority })
    }
  }

  return {
    files,
    busy: (index) => sending.has(index),
    failed,
    set: (indexes, priority) => void set(indexes, priority),
  }
}
