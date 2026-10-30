import { useEffect, useState } from 'react'
import { getTorrentFiles, type TorrentFile } from '../api/qbittorrent'

export const FILES_POLL_INTERVAL_MS = 3_000

export interface TorrentFilesState {
  /** Undefined until the first response arrives. */
  files?: TorrentFile[]
  /** The last request failed; `files` holds the last known list. */
  failed: boolean
  /**
   * When the poll whose answer `files` is was sent (ms since epoch), so a change qBittorrent took
   * after it can be shown over it.
   */
  requestedAt?: number
}

/** Polls a torrent's files (progress and priorities) while the page is visible. */
export function useTorrentFiles(hash: string): TorrentFilesState {
  // Keyed by hash, so another torrent's list never shows while this one loads.
  const [loaded, setLoaded] = useState<{ hash: string; files: TorrentFile[]; requestedAt: number }>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
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
  }, [hash])

  const current = loaded?.hash === hash ? loaded : undefined
  return { files: current?.files, failed, requestedAt: current?.requestedAt }
}
