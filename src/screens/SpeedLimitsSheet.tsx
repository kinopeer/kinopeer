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

/** Which fields a failed save sent: qBittorrent may have taken them. */
export interface SentLimits {
  download: boolean
  upload: boolean
}

export interface SpeedLimitsSheetProps {
  torrent: Torrent
  title: string
  /** qBittorrent is unreachable: the fields stay editable, saving waits until it answers. */
  offline: boolean
  /** A save for this torrent is in flight, from this sheet or one closed before it opened. */
  saving: boolean
  /** The last save failed, having sent these fields. */
  failure?: SentLimits
  /** Sends the changed limits; the screen closes the sheet once qBittorrent took them. */
  onSave: (limits: SpeedLimitsChange) => void
  /** Closed without saving: dismissed, or nothing changed. */
  onClose: () => void
}

type Direction = 'download' | 'upload'
const DIRECTIONS: Direction[] = ['download', 'upload']

/** Download and upload speed limits of one torrent; an empty field means no limit. */
export function SpeedLimitsSheet({ torrent, title, offline, saving, failure, onSave, onClose }: SpeedLimitsSheetProps) {
  const { t, i18n } = useTranslation()
  // What the fields showed when the sheet opened: an unchanged field isn't sent.
  const language = i18n.resolvedLanguage ?? i18n.language
  const [initial] = useState(() => ({
    download: limitToField(torrent.dl_limit, language),
    upload: limitToField(torrent.up_limit, language),
  }))
  const [text, setText] = useState(initial)
  // A field a failed save sent goes out again even when its text is back as it was, since
  // qBittorrent may have taken it.
  const download = changedLimit(initial.download, text.download, failure?.download)
  const upload = changedLimit(initial.upload, text.upload, failure?.upload)
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
