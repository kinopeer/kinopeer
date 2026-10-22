import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { Checkbox } from '../components/Checkbox'
import { Icon } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { ProgressBar } from '../components/ProgressBar'
import { Sheet } from '../components/Sheet'
import { useFormatters } from '../lib/format'
import { fileLabel, groupFiles, type FileGroup } from '../releases/fileGroups'
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

/** Full-height sheet to pick which files of a torrent to download, grouped by folder or season. */
export function FilePicker({ meta, skipped, onChange, free, subtitle, onDone }: FilePickerProps) {
  const { t } = useTranslation()
  const format = useFormatters()
  const groups = useMemo(() => groupFiles(meta.files), [meta.files])
  const flat = groups.length === 1 && groups[0].key === 'root'
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())

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
  const all = meta.files.map((_, index) => index)

  const fileRow = (index: number, group: FileGroup) => {
    const file = meta.files[index]
    const label = fileLabel(file.path, group)
    return (
      <li key={index} className={flat ? 'fp-file is-flat' : 'fp-file'}>
        <Checkbox label={label} checked={!skipped.has(index)} onChange={(selected) => setFiles([index], selected)} />
        <span className="ks-trunc fp-file-name" title={label}>
          {label}
        </span>
        <span className="ks-num c3 fp-file-size">{format.size(file.size)}</span>
      </li>
    )
  }

  return (
    <Sheet
      open
      onClose={onDone}
      title={t('add.selectFiles')}
      subtitle={subtitle}
      className="add-sheet is-full"
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
        <Button variant="secondary" size="sm" onClick={() => onChange(new Set(all))}>
          {t('add.selectNone')}
        </Button>
      </div>
      {flat ? (
        <ul className="fp-list">{groups[0].files.map((index) => fileRow(index, groups[0]))}</ul>
      ) : (
        <ul className="fp-list">
          {groups.map((group) => {
            const name = group.season ? t('add.season', { season: group.season }) : group.name || t('add.rootFiles')
            const selected = group.files.filter((index) => !skipped.has(index)).length
            const state = selected === 0 ? false : selected === group.files.length ? true : 'mixed'
            const expanded = open.has(group.key)
            return (
              <li key={group.key} className="fp-group">
                <div className="fp-group-head">
                  <Checkbox label={name} checked={state} onChange={(on) => setFiles(group.files, on)} />
                  <button
                    type="button"
                    className="fp-group-toggle"
                    aria-expanded={expanded}
                    onClick={() => {
                      const next = new Set(open)
                      if (expanded) next.delete(group.key)
                      else next.add(group.key)
                      setOpen(next)
                    }}
                  >
                    <Icon name="folder" className="c2" />
                    <span className="fp-group-text">
                      <span className="fp-group-name ks-trunc">{name}</span>
                      <span className="t-cap c3 ks-num">
                        {t('add.files', { count: group.files.length })} · {format.size(group.size)}
                      </span>
                    </span>
                    {state === 'mixed' && (
                      <span className="ks-num ca fp-group-count">
                        {selected}/{group.files.length}
                      </span>
                    )}
                    <Icon name="chevron-down" size={18} className="c3 fp-chevron" />
                  </button>
                </div>
                {expanded && <ul className="fp-files">{group.files.map((index) => fileRow(index, group))}</ul>}
              </li>
            )
          })}
        </ul>
      )}
    </Sheet>
  )
}
