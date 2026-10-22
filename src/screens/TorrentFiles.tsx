import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FilePriority, TorrentFile } from '../api/qbittorrent'
import { Banner } from '../components/Banner'
import { Icon } from '../components/Icon'
import { ProgressBar } from '../components/ProgressBar'
import { useFormatters } from '../lib/format'
import { fileLabel, groupFiles, type FileGroup } from '../releases/fileGroups'
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

/** A torrent's files with their progress and download priority, grouped by top folder. */
export function TorrentFiles({ hash, status, disabled }: TorrentFilesProps) {
  const { t } = useTranslation()
  const format = useFormatters()
  const { files, failed, setPriority } = useTorrentFiles(hash)
  const [saveFailed, setSaveFailed] = useState(false)

  const groups = useMemo(() => groupFiles((files ?? []).map((file) => ({ path: file.name, size: file.size }))), [files])

  const change = async (file: TorrentFile, choice: PriorityChoice) => {
    setSaveFailed(false)
    try {
      await setPriority([file.index], PRIORITY_VALUE[choice])
    } catch {
      setSaveFailed(true)
    }
  }

  const fileRow = (position: number, group: FileGroup) => {
    const file = files![position]
    const label = fileLabel(file.name, group)
    const choice = priorityChoice(file.priority)
    return (
      <li key={file.index} className={choice === 'skip' ? 'tf-file is-skipped' : 'tf-file'}>
        <div className="tf-file-body">
          <div className="tf-file-name ks-trunc" title={label}>
            {label}
          </div>
          <div className="tf-file-progress">
            <ProgressBar
              value={file.progress}
              status={choice === 'skip' ? 'paused' : file.progress >= 1 ? 'completed' : status}
              label={t('torrent.fileProgress', { name: label })}
              className="tf-bar"
            />
            <span className="ks-num c3 tf-meta">
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
      ) : groups.length === 1 ? (
        <ul className="tf-list">{groups[0].files.map((position) => fileRow(position, groups[0]))}</ul>
      ) : (
        groups.map((group) => (
          <div key={group.name} className="tf-group">
            <h3 className="tf-group-name">
              <Icon name="folder" size={18} className="c3" />
              <span className="ks-trunc">{group.name || t('add.rootFiles')}</span>
            </h3>
            <ul className="tf-list">{group.files.map((position) => fileRow(position, group))}</ul>
          </div>
        ))
      )}
    </section>
  )
}
