import { useCallback, useEffect, useState } from 'react'
import { getTorrentFiles, setFilePriority, type FilePriority, type TorrentFile } from '../api/qbittorrent'

export const FILES_POLL_INTERVAL_MS = 3_000

export interface TorrentFilesState {
  /** Undefined until the first response arrives. */
  files?: TorrentFile[]
  /** The last request failed; `files` holds the last known list. */
  failed: boolean
  /** Sets the priority of some files and shows it right away. Rejects when qBittorrent doesn't answer. */
  setPriority: (indexes: number[], priority: FilePriority) => Promise<void>
}

/** Polls a torrent's files (progress and priorities) while the page is visible. */
export function useTorrentFiles(hash: string): TorrentFilesState {
  // Keyed by hash, so another torrent's list never shows while this one loads.
  const [loaded, setLoaded] = useState<{ hash: string; files: TorrentFile[] }>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false

    const poll = async () => {
      clearTimeout(timer)
      try {
        const next = await getTorrentFiles(hash)
        if (stopped) return
        setLoaded({ hash, files: next })
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

  const setPriority = useCallback(
    async (indexes: number[], priority: FilePriority) => {
      await setFilePriority(hash, indexes, priority)
      setLoaded((current) =>
        current && {
          ...current,
          files: current.files.map((file) => (indexes.includes(file.index) ? { ...file, priority } : file)),
        },
      )
    },
    [hash],
  )

  return { files: loaded?.hash === hash ? loaded.files : undefined, failed, setPriority }
}
