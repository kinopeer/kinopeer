import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Torrent } from '../api/qbittorrent'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { Sheet } from '../components/Sheet'
import { changedLimit, isUnfinished, limitToField, MAX_MB, MIN_MB } from '../torrents/speedLimits'
import './SpeedLimitsSheet.css'

/** The limits a save sends, in bytes/s: 0 removes one, and one left out stays as it is. */
export interface SpeedLimitsChange {
  download?: number
  upload?: number
}

export interface SpeedLimitsSheetProps {
  torrent: Torrent
  title: string
  /** qBittorrent is unreachable: the fields stay editable, saving waits until it answers. */
  offline: boolean
  /** The limits being saved for this torrent, from this sheet or one closed before it opened, which
   *  this one then starts from. */
  pending?: SpeedLimitsChange
  /** The last save failed, having sent these limits: qBittorrent may have taken some. */
  failure?: SpeedLimitsChange
  /** Sends the changed limits; the screen closes the sheet once qBittorrent took them. */
  onSave: (limits: SpeedLimitsChange) => void
  /** Closed without saving: dismissed, or nothing changed. */
  onClose: () => void
}

type Direction = 'download' | 'upload'
const DIRECTIONS: Direction[] = ['download', 'upload']

/** Download and upload speed limits of one torrent; an empty field means no limit. */
export function SpeedLimitsSheet({ torrent, title, offline, pending, failure, onSave, onClose }: SpeedLimitsSheetProps) {
  const { t, i18n } = useTranslation()
  // What the fields showed when the sheet opened: an unchanged field isn't sent.
  const language = i18n.resolvedLanguage ?? i18n.language
  const [initial] = useState(() => ({
    download: limitToField(torrent.dl_limit, language),
    upload: limitToField(torrent.up_limit, language),
  }))
  // Opened while a save is in flight, the fields show what it sends, as the sheet that sent it did.
  const [text, setText] = useState(() => ({
    download: pending?.download === undefined ? initial.download : limitToField(pending.download, language),
    upload: pending?.upload === undefined ? initial.upload : limitToField(pending.upload, language),
  }))
  const saving = pending !== undefined
  // A field a failed save sent goes out again even when its text is back as it was, since
  // qBittorrent may have taken it.
  const download = changedLimit(initial.download, text.download, failure?.download !== undefined)
  const upload = changedLimit(initial.upload, text.upload, failure?.upload !== undefined)
  const limits = { download, upload }
  const valid = download !== null && upload !== null
  const invalid = t('limits.invalid', { min: MIN_MB.toLocaleString(language), max: MAX_MB })

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!valid || offline || saving) return
    if (download === undefined && upload === undefined) return onClose()
    onSave({ download, upload })
  }

  return (
    <Sheet open onClose={onClose} title={t('limits.title')} subtitle={title}>
      <form className="limits-form" onSubmit={save}>
        {DIRECTIONS.map((direction) => (
          <Input
            key={direction}
            label={t(`limits.${direction}`)}
            inputMode="decimal"
            help={t('limits.hint')}
            value={text[direction]}
            onChange={(event) => {
              const value = event.target.value
              setText((fields) => ({ ...fields, [direction]: value }))
            }}
            error={limits[direction] === null && !isUnfinished(text[direction]) ? invalid : false}
          />
        ))}
        {failure && <Banner tone="error">{t('limits.failed')}</Banner>}
        <Button type="submit" variant="primary" size="lg" block loading={saving} disabled={!valid || saving || offline}>
          {t('limits.save')}
        </Button>
      </form>
    </Sheet>
  )
}
