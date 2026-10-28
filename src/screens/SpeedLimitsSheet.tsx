import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { setSpeedLimits, type Torrent } from '../api/qbittorrent'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { Sheet } from '../components/Sheet'
import { changedLimit, limitToField } from '../torrents/speedLimits'

export interface SpeedLimitsSheetProps {
  torrent: Torrent
  title: string
  /** qBittorrent is unreachable: the fields stay editable, saving waits until it answers. */
  offline: boolean
  onClose: () => void
  /** After the limits were saved, so the list can refresh right away. */
  onChanged: () => void
}

/** Download and upload speed limits of one torrent; an empty field means no limit. */
export function SpeedLimitsSheet({ torrent, title, offline, onClose, onChanged }: SpeedLimitsSheetProps) {
  const { t, i18n } = useTranslation()
  // What the fields showed when the sheet opened: an unchanged field isn't sent.
  const [initial] = useState(() => {
    const language = i18n.resolvedLanguage ?? i18n.language
    return { download: limitToField(torrent.dl_limit, language), upload: limitToField(torrent.up_limit, language) }
  })
  const [download, setDownload] = useState(initial.download)
  const [upload, setUpload] = useState(initial.upload)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const downloadLimit = changedLimit(initial.download, download)
  const uploadLimit = changedLimit(initial.upload, upload)
  const valid = downloadLimit !== null && uploadLimit !== null

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!valid || offline) return
    if (downloadLimit === undefined && uploadLimit === undefined) return onClose()
    setSaving(true)
    setFailed(false)
    try {
      await setSpeedLimits([torrent.hash], { download: downloadLimit, upload: uploadLimit })
      onChanged()
      onClose()
    } catch {
      // One of the two requests may have gone through: show the list what was applied.
      onChanged()
      setFailed(true)
      setSaving(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title={t('limits.title')} subtitle={title}>
      <form className="limits-form" onSubmit={save}>
        <Input
          label={t('limits.download')}
          inputMode="decimal"
          placeholder={t('limits.unlimited')}
          help={t('limits.hint')}
          value={download}
          onChange={(event) => setDownload(event.target.value)}
          error={downloadLimit === null ? t('limits.invalid') : false}
        />
        <Input
          label={t('limits.upload')}
          inputMode="decimal"
          placeholder={t('limits.unlimited')}
          help={t('limits.hint')}
          value={upload}
          onChange={(event) => setUpload(event.target.value)}
          error={uploadLimit === null ? t('limits.invalid') : false}
        />
        {failed && <Banner tone="error">{t('limits.failed')}</Banner>}
        <Button type="submit" variant="primary" size="lg" block loading={saving} disabled={!valid || saving || offline}>
          {t('limits.save')}
        </Button>
      </form>
    </Sheet>
  )
}
