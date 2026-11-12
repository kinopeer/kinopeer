import { useEffect, useState } from 'react'
import { getTorrentFiles, type TorrentFile } from '../api/qbittorrent'
import { FILES_POLL_INTERVAL_MS } from './pollIntervals'

export type TorrentFilesState = {
  /** The last request failed; `files` holds the last known list. */
  failed: boolean
} & (
  | {
      files: TorrentFile[]
      /**
       * When the poll whose answer `files` is was sent (ms since epoch), so a change qBittorrent
       * took after it can be shown over it.
       */
      requestedAt: number
    }
  /** Until the first response arrives. */
  | { files?: undefined; requestedAt?: undefined }
)

/**
 * Polls a torrent's files (progress and priorities) while the page is visible and `enabled`. While
 * it isn't, nothing is asked and the last answer for the torrent stays.
 */
export function useTorrentFiles(hash: string, enabled = true): TorrentFilesState {
  // Keyed by hash, so another torrent's list never shows while this one loads.
  const [loaded, setLoaded] = useState<{ hash: string; files: TorrentFile[]; requestedAt: number }>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false

    const poll = async () => {
      clearTimeout(timer)
      const requestedAt = Date.now()
      try {
        const next = await getTorrentFiles(hash)
        if (stopped) return
        setLoaded({ hash, files: next, requestedAt })
        setFailed(false)
      } catch {
        if (stopped) return
        setFailed(true)
      }
      if (!document.hidden) timer = setTimeout(() => void poll(), FILES_POLL_INTERVAL_MS)
    }

    const onVisibilityChange = () => {
      if (document.hidden) clearTimeout(timer)
      else void poll()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    void poll()
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [hash, enabled])

  if (loaded?.hash !== hash) return { failed }
  return { files: loaded.files, requestedAt: loaded.requestedAt, failed }
}
