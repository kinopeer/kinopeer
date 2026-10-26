import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FilePriority, TorrentFile } from '../api/qbittorrent'
import { Banner } from '../components/Banner'
import { Icon } from '../components/Icon'
import { ProgressBar } from '../components/ProgressBar'
import { useFormatters } from '../lib/format'
import { buildFileTree, fileName, initiallyOpen, type FileFolder } from '../releases/fileTree'
import type { DownloadStatus } from '../torrents/status'
import { useTorrentFiles } from '../torrents/useTorrentFiles'

export interface TorrentFilesProps {
  hash: string
  /** The torrent's status, for the color of the progress bars. */
  status: DownloadStatus
  /** qBittorrent is unreachable: priorities can't be changed. */
  disabled?: boolean
}

type PriorityChoice = 'skip' | 'normal' | 'high'

const PRIORITY_VALUE: Record<PriorityChoice, FilePriority> = { skip: 0, normal: 1, high: 6 }

function priorityChoice(priority: FilePriority): PriorityChoice {
  return priority === 0 ? 'skip' : priority === 1 ? 'normal' : 'high'
}

/** A torrent's files with their progress and download priority, as the torrent's folder tree. */
export function TorrentFiles({ hash, status, disabled }: TorrentFilesProps) {
  const { t } = useTranslation()
  const format = useFormatters()
  const { files, failed, setPriority } = useTorrentFiles(hash)
  const [saveFailed, setSaveFailed] = useState(false)

  const tree = useMemo(() => buildFileTree((files ?? []).map((file) => ({ path: file.name, size: file.size }))), [files])
  // Folders the user opened or closed; the rest follow initiallyOpen, which needs the file list first.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())
  const opened = initiallyOpen(tree)
  const isOpen = (path: string) => opened.has(path) !== toggled.has(path)
  const toggle = (path: string) =>
    setToggled((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const change = async (file: TorrentFile, choice: PriorityChoice) => {
    setSaveFailed(false)
    try {
      await setPriority([file.index], PRIORITY_VALUE[choice])
    } catch {
      setSaveFailed(true)
    }
  }

  const fileRow = (position: number) => {
    const file = files![position]
    const label = fileName(file.name)
    const choice = priorityChoice(file.priority)
    return (
      <li key={file.index} className={choice === 'skip' ? 'tf-file is-skipped' : 'tf-file'}>
        <div className="tf-file-body">
          <div className="t-cap tf-file-name ks-trunc" title={label}>
            {label}
          </div>
          <div className="tf-file-progress">
            <ProgressBar
              value={file.progress}
              status={choice === 'skip' ? 'paused' : file.progress >= 1 ? 'completed' : status}
              label={t('torrent.fileProgress', { name: label })}
              className="tf-bar"
            />
            <span className="t-cap ks-num c3 tf-meta">
              {format.percent(file.progress)} · {format.size(file.size)}
            </span>
          </div>
        </div>
        <span className={choice === 'high' ? 'ks-chip is-on tf-priority' : 'ks-chip tf-priority'}>
          <select
            aria-label={t('torrent.priorityOf', { name: label })}
            value={choice}
            disabled={disabled}
            onChange={(event) => void change(file, event.target.value as PriorityChoice)}
          >
            <option value="skip">{t('torrent.prioritySkip')}</option>
            <option value="normal">{t('torrent.priorityNormal')}</option>
            <option value="high">{t('torrent.priorityHigh')}</option>
          </select>
          <Icon name="chevron-down" size={14} />
        </span>
      </li>
    )
  }

  const folderRow = (folder: FileFolder) => {
    const expanded = isOpen(folder.path)
    const done = folder.all.reduce((sum, position) => sum + files![position].size * files![position].progress, 0)
    return (
      <li key={folder.path} className="tf-folder">
        <button type="button" className="tf-folder-toggle" aria-expanded={expanded} onClick={() => toggle(folder.path)}>
          <Icon name="folder" className="c2" />
          <span className="tf-folder-text">
            <span className="t-body tf-folder-name ks-trunc">{folder.name}</span>
            <span className="t-cap c3 ks-num">
              {t('add.files', { count: folder.all.length })} · {format.size(folder.size)} ·{' '}
              {format.percent(folder.size ? done / folder.size : 0)}
            </span>
          </span>
          <Icon name="chevron-down" size={18} className="c3 tf-chevron" />
        </button>
        {expanded && <ul className="tf-list tf-sub">{contents(folder)}</ul>}
      </li>
    )
  }

  const contents = (folder: FileFolder) => [...folder.folders.map(folderRow), ...folder.files.map(fileRow)]

  return (
    <section className="tf" aria-labelledby="torrent-files-title" aria-busy={files === undefined}>
      <h2 id="torrent-files-title" className="t-h3 tf-title">
        {t('torrent.files')} {files && <span className="c3 ks-num tf-count">{files.length}</span>}
      </h2>
      {(saveFailed || (failed && files === undefined)) && (
        <Banner tone="error">{saveFailed ? t('torrent.priorityFailed') : t('torrent.filesFailed')}</Banner>
      )}
      {files === undefined ? (
        !failed && (
          <div role="status" className="tf-loading">
            <span className="sr-only">{t('torrent.filesLoading')}</span>
            {[0, 1, 2].map((row) => (
              <div key={row} className="ks-skel tf-skel" aria-hidden="true" />
            ))}
          </div>
        )
      ) : files.length === 0 ? (
        <p className="t-body c2">{t('torrent.filesMetadata')}</p>
      ) : (
        <ul className="tf-list">{contents(tree)}</ul>
      )}
    </section>
  )
}
