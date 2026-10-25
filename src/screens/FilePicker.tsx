import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { Checkbox } from '../components/Checkbox'
import { Icon } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { ProgressBar } from '../components/ProgressBar'
import { Sheet } from '../components/Sheet'
import { useFormatters } from '../lib/format'
import { buildFileTree, fileName, initiallyOpen, type FileFolder } from '../releases/fileTree'
import type { TorrentMeta } from '../torrents/torrentFile'

export interface FilePickerProps {
  meta: TorrentMeta
  /** Indexes into `meta.files` that won't be downloaded. */
  skipped: ReadonlySet<number>
  onChange: (skipped: ReadonlySet<number>) => void
  /** Free space where the torrent goes, when qBittorrent reported it. */
  free?: number
  subtitle: string
  onDone: () => void
}

/** The torrent's files with its own folder, which .torrent paths leave out, so buildFileTree treats them like qBittorrent's. */
function treeOf(meta: TorrentMeta): FileFolder {
  const single = meta.files.length === 1 && meta.files[0].path === meta.name
  return buildFileTree(
    single || !meta.name ? meta.files : meta.files.map((file) => ({ ...file, path: `${meta.name}/${file.path}` })),
  )
}

/** Full-height sheet to pick which files of a torrent to download, as a folder tree. */
export function FilePicker({ meta, skipped, onChange, free, subtitle, onDone }: FilePickerProps) {
  const { t } = useTranslation()
  const format = useFormatters()
  const tree = useMemo(() => treeOf(meta), [meta])
  const [open, setOpen] = useState<ReadonlySet<string>>(() => initiallyOpen(tree))

  const setFiles = (indexes: number[], selected: boolean) => {
    const next = new Set(skipped)
    for (const index of indexes) {
      if (selected) next.delete(index)
      else next.add(index)
    }
    onChange(next)
  }
  const selectedCount = meta.files.length - skipped.size
  const selectedSize = meta.files.reduce((sum, file, index) => (skipped.has(index) ? sum : sum + file.size), 0)
  const tooBig = free !== undefined && selectedSize > free

  const fileRow = (index: number) => {
    const file = meta.files[index]
    const label = fileName(file.path)
    return (
      <li key={index} className="fp-file">
        <Checkbox label={label} checked={!skipped.has(index)} onChange={(selected) => setFiles([index], selected)} />
        <span className="ks-trunc fp-file-name" title={label}>
          {label}
        </span>
        <span className="ks-num c3 fp-file-size">{format.size(file.size)}</span>
      </li>
    )
  }

  const folderRow = (folder: FileFolder) => {
    const selected = folder.all.filter((index) => !skipped.has(index)).length
    const state = selected === 0 ? false : selected === folder.all.length ? true : 'mixed'
    const expanded = open.has(folder.path)
    return (
      <li key={folder.path} className="fp-group">
        <div className="fp-group-head">
          <Checkbox label={folder.name} checked={state} onChange={(on) => setFiles(folder.all, on)} />
          <button
            type="button"
            className="fp-group-toggle"
            aria-expanded={expanded}
            onClick={() => {
              const next = new Set(open)
              if (expanded) next.delete(folder.path)
              else next.add(folder.path)
              setOpen(next)
            }}
          >
            <Icon name="folder" className="c2" />
            <span className="fp-group-text">
              <span className="fp-group-name ks-trunc">{folder.name}</span>
              <span className="t-cap c3 ks-num">
                {t('add.files', { count: folder.all.length })} · {format.size(folder.size)}
              </span>
            </span>
            {state === 'mixed' && (
              <span className="ks-num ca fp-group-count">
                {selected}/{folder.all.length}
              </span>
            )}
            <Icon name="chevron-down" size={18} className="c3 fp-chevron" />
          </button>
        </div>
        {expanded && <ul className="fp-files">{contents(folder)}</ul>}
      </li>
    )
  }

  const contents = (folder: FileFolder) => [...folder.folders.map(folderRow), ...folder.files.map(fileRow)]

  return (
    <Sheet
      open
      onClose={onDone}
      title={t('add.selectFiles')}
      subtitle={subtitle}
      size="lg"
      leading={<IconButton icon="chevron-left" label={t('add.back')} iconSize={24} onClick={onDone} />}
      footer={
        <div className="fp-foot">
          <div className="fp-summary">
            <span className="t-label ks-num fp-count" aria-live="polite">
              {t('add.selectedSummary', {
                selected: selectedCount,
                count: meta.files.length,
                size: format.size(selectedSize),
              })}
            </span>
            {free !== undefined && (
              <span className={tooBig ? 't-cap ks-num c-err' : 't-cap ks-num c3'}>
                {tooBig ? t('add.notEnough') : t('add.freeSpace', { size: format.size(free) })}
              </span>
            )}
          </div>
          {free !== undefined && free > 0 && (
            <ProgressBar
              value={Math.min(1, selectedSize / free)}
              status={tooBig ? 'error' : 'downloading'}
              label={t('add.diskUsage')}
            />
          )}
          <Button variant="primary" block disabled={selectedCount === 0} onClick={onDone}>
            {t('add.done')}
          </Button>
        </div>
      }
    >
      <div className="fp-actions">
        <Button variant="secondary" size="sm" onClick={() => onChange(new Set())}>
          {t('add.selectAll')}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onChange(new Set(tree.all))}>
          {t('add.selectNone')}
        </Button>
      </div>
      <ul className="fp-list">{contents(tree)}</ul>
    </Sheet>
  )
}
