import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { setSpeedLimits, type Torrent } from '../api/qbittorrent'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { Sheet } from '../components/Sheet'
import { changedLimit, isUnfinished, limitToField, MAX_MB, MIN_MB } from '../torrents/speedLimits'
import './SpeedLimitsSheet.css'

export interface SpeedLimitsSheetProps {
  torrent: Torrent
  title: string
  /** qBittorrent is unreachable: the fields stay editable, saving waits until it answers. */
  offline: boolean
  /** Closed without saving: dismissed, or nothing changed. */
  onClose: () => void
  /** qBittorrent took the limits: the screen refreshes and closes the sheet if it still shows it. */
  onSaved: () => void
  /** qBittorrent refused them, maybe after taking one: the screen refreshes, and says so if the
   *  sheet was closed meanwhile (an open sheet says so itself). */
  onFailed: () => void
}

type Direction = 'download' | 'upload'
const DIRECTIONS: Direction[] = ['download', 'upload']

/** Download and upload speed limits of one torrent; an empty field means no limit. */
export function SpeedLimitsSheet({ torrent, title, offline, onClose, onSaved, onFailed }: SpeedLimitsSheetProps) {
  const { t, i18n } = useTranslation()
  // What the fields showed when the sheet opened: an unchanged field isn't sent.
  const language = i18n.resolvedLanguage ?? i18n.language
  const [initial] = useState(() => ({
    download: limitToField(torrent.dl_limit, language),
    upload: limitToField(torrent.up_limit, language),
  }))
  const [text, setText] = useState(initial)
  // The fields a failed save sent: qBittorrent may have taken them, so they're sent again even when
  // their text is back as it was.
  const [resend, setResend] = useState({ download: false, upload: false })
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const download = changedLimit(initial.download, text.download, resend.download)
  const upload = changedLimit(initial.upload, text.upload, resend.upload)
  const limits = { download, upload }
  const valid = download !== null && upload !== null
  const invalid = t('limits.invalid', { min: MIN_MB.toLocaleString(language), max: MAX_MB })

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!valid || offline || saving) return
    if (download === undefined && upload === undefined) return onClose()
    setSaving(true)
    setFailed(false)
    try {
      await setSpeedLimits([torrent.hash], { download, upload })
      onSaved()
    } catch {
      onFailed()
      setResend((sent) => ({
        download: sent.download || download !== undefined,
        upload: sent.upload || upload !== undefined,
      }))
      setFailed(true)
      setSaving(false)
    }
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
        {failed && <Banner tone="error">{t('limits.failed')}</Banner>}
        <Button type="submit" variant="primary" size="lg" block loading={saving} disabled={!valid || saving || offline}>
          {t('limits.save')}
        </Button>
      </form>
    </Sheet>
  )
}
