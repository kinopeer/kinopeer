import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { setSpeedLimits, type Torrent } from '../api/qbittorrent'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { Sheet } from '../components/Sheet'
import { fieldToLimit, limitToField } from '../torrents/speedLimits'

export interface SpeedLimitsSheetProps {
  torrent: Torrent
  title: string
  onClose: () => void
  /** After the limits were saved, so the list can refresh right away. */
  onChanged: () => void
}

/** Download and upload speed limits of one torrent; an empty field means no limit. */
export function SpeedLimitsSheet({ torrent, title, onClose, onChanged }: SpeedLimitsSheetProps) {
  const { t } = useTranslation()
  const [download, setDownload] = useState(() => limitToField(torrent.dl_limit))
  const [upload, setUpload] = useState(() => limitToField(torrent.up_limit))
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const downloadLimit = fieldToLimit(download)
  const uploadLimit = fieldToLimit(upload)
  const valid = downloadLimit !== null && uploadLimit !== null

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (downloadLimit === null || uploadLimit === null) return
    setSaving(true)
    setFailed(false)
    try {
      await setSpeedLimits([torrent.hash], { download: downloadLimit, upload: uploadLimit })
      onChanged()
      onClose()
    } catch {
      setFailed(true)
      setSaving(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title={t('limits.title')} subtitle={title} className="limits-sheet">
      <form className="limits-form" onSubmit={save}>
        <Input
          label={t('limits.download')}
          inputMode="decimal"
          placeholder={t('limits.unlimited')}
          value={download}
          onChange={(event) => setDownload(event.target.value)}
          error={downloadLimit === null ? t('limits.invalid') : false}
        />
        <Input
          label={t('limits.upload')}
          inputMode="decimal"
          placeholder={t('limits.unlimited')}
          value={upload}
          onChange={(event) => setUpload(event.target.value)}
          error={uploadLimit === null ? t('limits.invalid') : false}
        />
        <p className="t-cap c3">{t('limits.hint')}</p>
        {failed && <Banner tone="error">{t('limits.failed')}</Banner>}
        <Button type="submit" variant="primary" size="lg" block loading={saving} disabled={!valid || saving}>
          {t('limits.save')}
        </Button>
      </form>
    </Sheet>
  )
}
