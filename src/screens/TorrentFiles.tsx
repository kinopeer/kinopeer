import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FilePriority, Torrent } from '../api/qbittorrent'
import { Accordion } from '../components/Accordion'
import { Banner } from '../components/Banner'
import { Icon } from '../components/Icon'
import { ProgressBar } from '../components/ProgressBar'
import { useFormatters } from '../lib/format'
import { buildFileTree, fileName, initiallyOpen, type FileFolder } from '../releases/fileTree'
import type { DownloadStatus } from '../torrents/status'
import { useTorrentFiles } from '../torrents/useTorrentFiles'
import { useFilePriorities } from './useFilePriorities'

export interface TorrentFilesProps {
  torrent: Torrent
  /** The torrent's status, for the color of the progress bars. */
  status: DownloadStatus
  /** qBittorrent is unreachable, or the torrent is being deleted: priorities can't be changed. */
  disabled?: boolean
}

const NONE: ReadonlySet<string> = new Set()

type PriorityChoice = 'skip' | 'normal' | 'high'

const PRIORITY_VALUE: Record<PriorityChoice, FilePriority> = { skip: 0, normal: 1, high: 6 }

function priorityChoice(priority: FilePriority): PriorityChoice {
  return priority === 0 ? 'skip' : priority === 1 ? 'normal' : 'high'
}

interface PrioritySelectProps {
  label: string
  /** `mixed` for a folder whose files differ. */
  value: PriorityChoice | 'mixed'
  busy: boolean
  disabled?: boolean
  onChange: (priority: FilePriority) => void
}

/** The priority picker of a file or a folder, as a chip. */
function PrioritySelect({ label, value, busy, disabled, onChange }: PrioritySelectProps) {
  const { t } = useTranslation()
  return (
    <span className={value === 'high' ? 'ks-chip is-on tf-priority' : 'ks-chip tf-priority'}>
      <select
        aria-label={label}
        value={value}
        aria-busy={busy || undefined}
        disabled={disabled || busy}
        onChange={(event) => onChange(PRIORITY_VALUE[event.target.value as PriorityChoice])}
      >
        {value === 'mixed' && (
          <option value="mixed" disabled hidden>
            {t('torrent.priorityMixed')}
          </option>
        )}
        <option value="skip">{t('torrent.prioritySkip')}</option>
        <option value="normal">{t('torrent.priorityNormal')}</option>
        <option value="high">{t('torrent.priorityHigh')}</option>
      </select>
      <Icon name="chevron-down" size={14} />
    </span>
  )
}

/**
 * A torrent's files with their progress and download priority, as the torrent's folder tree, in a
 * section that's closed at first and polls the files only while open; their count shows once the
 * list has loaded. A
 * folder's priority sets every file under it, and shows Mixed while they differ. A change is on its
 * way while the pickers of its files are off, and of the folders above them (`useFilePriorities`),
 * so a folder can't change while one of its files does, nor a file while its folder does.
 */
export function TorrentFiles({ torrent, status, disabled }: TorrentFilesProps) {
  const { t } = useTranslation()
  const format = useFormatters()
  const [open, setOpen] = useState(false)
  // Closed, the list isn't polled; the last one stays for the count and for opening it again.
  const list = useTorrentFiles(torrent.hash, open)
  const { failed } = list
  // A failure while closed goes to a toast, since the list that would say it isn't there.
  const priorities = useFilePriorities(torrent, list, open)
  const { files } = priorities
  const saveFailed = priorities.failed

  // Built only while open, since nothing shows it while closed.
  const tree = useMemo(
    () => (open && files ? buildFileTree(files.map((file) => ({ path: file.name, size: file.size }))) : undefined),
    [open, files],
  )
  // Folders the user opened or closed; the rest follow initiallyOpen, which needs the file list first.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())
  const opened = tree ? initiallyOpen(tree) : NONE
  const isOpen = (path: string) => opened.has(path) !== toggled.has(path)
  const toggle = (path: string) =>
    setToggled((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const fileRow = (position: number) => {
    const file = files![position]
    const label = fileName(file.name)
    const choice = priorityChoice(file.priority)
    const busy = priorities.busy(file.index)
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
              label={t('common.progressOf', { name: label })}
              className="tf-bar"
            />
            <span className="t-cap ks-num c3 tf-meta">
              {format.percent(file.progress)} · {format.size(file.size)}
            </span>
          </div>
        </div>
        <PrioritySelect
          label={t('torrent.priorityOf', { name: label })}
          value={choice}
          busy={busy}
          disabled={disabled}
          onChange={(priority) => priorities.set([file.index], priority)}
        />
      </li>
    )
  }

  const folderRow = (folder: FileFolder) => {
    const expanded = isOpen(folder.path)
    // Positions in the list, which the tree is built from; the requests take qBittorrent's indexes.
    const inside = folder.all.map((position) => files![position])
    const done = inside.reduce((sum, file) => sum + file.size * file.progress, 0)
    const choices = new Set(inside.map((file) => priorityChoice(file.priority)))
    return (
      <li key={folder.path} className="tf-folder">
        <div className="tf-folder-head">
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
          <PrioritySelect
            label={t('torrent.priorityOfFolder', { name: folder.name })}
            value={choices.size === 1 ? [...choices][0] : 'mixed'}
            busy={inside.some((file) => priorities.busy(file.index))}
            disabled={disabled}
            onChange={(priority) => priorities.set(inside.map((file) => file.index), priority)}
          />
        </div>
        {expanded && <ul className="tf-list tf-sub">{contents(folder)}</ul>}
      </li>
    )
  }

  const contents = (folder: FileFolder) => [...folder.folders.map(folderRow), ...folder.files.map(fileRow)]

  return (
    <Accordion
      heading
      bodyClassName="tf-body"
      title={
        <>
          {t('torrent.files')} {files && <span className="c3 ks-num tf-count">{files.length}</span>}
        </>
      }
      open={open}
      onOpenChange={setOpen}
      aria-busy={open && files === undefined}
    >
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
        // The children are built here even while closed, so the rows only when there's a tree.
        tree && <ul className="tf-list">{contents(tree)}</ul>
      )}
    </Accordion>
  )
}
