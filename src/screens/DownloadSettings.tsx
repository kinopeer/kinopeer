import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { Torrent } from '../api/qbittorrent'
import { Icon } from '../components/Icon'
import { Toggle } from '../components/Toggle'
import { useDownloadToggle } from './useDownloadToggle'

export interface DownloadSettingsProps {
  torrent: Torrent
  /** qBittorrent is unreachable, or the torrent is being deleted: nothing can be changed. */
  disabled: boolean
  /** A category is being sent for the torrent, from anywhere. */
  categoryBusy: boolean
  /** Opens the Category sheet. */
  onCategory: () => void
}

/**
 * The torrent page's Download section, always open: the category, which opens its sheet, and, until
 * the torrent is complete, sequential download and first and last pieces first, which only change
 * how the rest downloads.
 */
export function DownloadSettings({ torrent, disabled, categoryBusy, onCategory }: DownloadSettingsProps) {
  const { t } = useTranslation()
  const headingId = useId()
  const sequential = useDownloadToggle('seq_dl')
  const pieces = useDownloadToggle('f_l_piece_prio')
  const category = torrent.category || t('category.none')

  return (
    <section aria-labelledby={headingId} className="torrent-download">
      <h2 id={headingId} className="torrent-download-heading">
        {t('torrent.download')}
      </h2>
      <button
        type="button"
        className="ks-row-btn torrent-download-row"
        aria-label={t('torrent.categoryValue', { category })}
        disabled={disabled || categoryBusy}
        onClick={onCategory}
      >
        <span className="torrent-download-label">{t('category.title')}</span>
        <span className="t-label ks-trunc">{category}</span>
        <Icon name="chevron-right" size={18} className="c3" />
      </button>
      {torrent.progress < 1 &&
        [
          { toggle: sequential, label: t('add.sequential') },
          { toggle: pieces, label: t('add.firstLastPieces') },
        ].map(({ toggle, label }) => {
          const on = toggle.value(torrent)
          return (
            <div key={label} className="torrent-download-row">
              <span className="torrent-download-label">{label}</span>
              <Toggle
                label={label}
                checked={on}
                disabled={disabled || toggle.busy(torrent.hash)}
                onChange={(checked) => void toggle.set(torrent, checked)}
              />
            </div>
          )
        })}
    </section>
  )
}
