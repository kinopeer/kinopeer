import { useId, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { getSaveLocations, type SaveLocations, type Torrent } from '../api/qbittorrent'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { Sheet } from '../components/Sheet'
import { useRequest } from '../lib/useRequest'
import { categoryChange, type CategoryChange } from '../torrents/categoryChange'
import './CategorySheet.css'

export interface CategorySheetProps {
  torrent: Torrent
  /** qBittorrent is unreachable: Save is off. */
  offline: boolean
  /** The category being sent for this torrent, from this sheet or one closed before it opened, which
   *  this one then starts from. */
  pending?: string
  /** The last category sent wasn't taken. */
  failed: boolean
  onSave: (category: string, change: CategoryChange) => void
  onClose: () => void
}

/** The categories to pick from: none, qBittorrent's, and the torrent's own even if it's gone from them. */
function options(torrent: Torrent, locations: SaveLocations | undefined): string[] {
  const names = ['', ...(locations?.categories.map((category) => category.name) ?? [])]
  return names.includes(torrent.category) ? names : [...names, torrent.category]
}

/**
 * A torrent's category, picked from qBittorrent's, and what the change does with its files: under
 * automatic management each category shows the folder they'd move to, and the note under the list
 * says what happens for the one picked.
 */
export function CategorySheet({ torrent, offline, pending, failed, onSave, onClose }: CategorySheetProps) {
  const { t } = useTranslation()
  const name = useId()
  const where = useRequest('qbt|save-locations', (signal) => getSaveLocations(signal))
  const locations = where.data
  // Opened while a change is in flight, it shows the category being sent, as the sheet that sent it did.
  const [category, setCategory] = useState(pending ?? torrent.category)
  const sending = pending !== undefined
  const change = locations && categoryChange(torrent, category, locations)
  const unchanged = category === torrent.category
  // Each category's folder only where picking it moves the files there.
  const moves = !!locations && torrent.auto_tmm && locations.relocateOnCategoryChange

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('category.title')}
      subtitle={torrent.name}
      action={<IconButton icon="close" label={t('torrent.cancel')} onClick={onClose} />}
      footer={
        <Button
          variant="primary"
          size="lg"
          block
          loading={sending}
          disabled={!change || unchanged || sending || offline}
          onClick={() => change && onSave(category, change)}
        >
          {t('category.save')}
        </Button>
      }
    >
      <div className="category-body">
        <fieldset className="category-options">
          <legend className="sr-only">{t('category.title')}</legend>
          {options(torrent, locations).map((option, index) => {
            const folder = moves && locations ? categoryChange(torrent, option, locations).folder : ''
            const folderId = `${name}-${index}`
            return (
              <label key={option} className="ks-row-btn category-option">
                <input
                  type="radio"
                  className="sr-only"
                  name={name}
                  value={option}
                  checked={category === option}
                  disabled={sending}
                  aria-describedby={folder ? folderId : undefined}
                  onChange={() => setCategory(option)}
                />
                <span className="ks-row-text category-option-text">
                  <span>{option || t('category.none')}</span>
                  {/* A description rather than part of the name, so the option reads as the category. */}
                  {folder && (
                    <span id={folderId} className="ks-row-hint category-folder" aria-hidden="true">
                      {folder}
                    </span>
                  )}
                </span>
                {category === option && <Icon name="check" strokeWidth={2.4} className="ca" />}
              </label>
            )
          })}
        </fieldset>
        {change && !unchanged && <p className="t-cap c2">{noteOf(change, t)}</p>}
        {failed && <Banner tone="error">{t('torrent.actionFailed')}</Banner>}
      </div>
    </Sheet>
  )
}

function noteOf(change: CategoryChange, t: TFunction): string {
  const { folder } = change
  switch (change.kind) {
    case 'move':
      return folder ? t('category.moves', { folder }) : t('category.movesToCategory')
    case 'stay':
      return t('category.stays', { folder })
    case 'toManual':
      return t('category.toManual', { folder })
    case 'manual':
      return t('category.manual', { folder })
  }
}
