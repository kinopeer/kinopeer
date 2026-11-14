import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { Menu, MenuItemRadio } from '../components/Menu'
import { Segmented } from '../components/Segmented'
import { Sheet } from '../components/Sheet'
import { DOWNLOAD_SORTS, type DownloadSort } from '../torrents/sort'
import { TYPE_FILTERS, type TypeFilter } from '../torrents/titleLookup'

export interface SortSheetProps {
  open: boolean
  value: DownloadSort
  onChange: (sort: DownloadSort) => void
  type: TypeFilter
  onTypeChange: (type: TypeFilter) => void
  onClose: () => void
}

/** Picks the order of the downloads list and the type it shows. A pick applies right away; Done closes the sheet. */
export function SortSheet({ open, value, onChange, type, onTypeChange, onClose }: SortSheetProps) {
  const { t } = useTranslation()
  const name = useId()
  const hintId = useId()

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('downloads.sortFilter')}
      action={
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('common.done')}
        </Button>
      }
    >
      <div className="sort-sheet">
        <div className="ks-field">
          <span className="ks-label">{t('common.type')}</span>
          <Segmented
            label={t('common.type')}
            options={TYPE_FILTERS.map((key) => ({
              value: key,
              label: key === 'all' ? t('common.all') : t(`types.${key}`),
            }))}
            value={type}
            onChange={onTypeChange}
          />
        </div>
        <fieldset className="sort-options">
          <legend className="ks-label">{t('common.sort')}</legend>
          {DOWNLOAD_SORTS.map((sort) => (
            <label key={sort} className="ks-row-btn sort-option">
              <input
                type="radio"
                className="sr-only"
                name={name}
                value={sort}
                checked={value === sort}
                onChange={() => onChange(sort)}
                aria-describedby={sort === 'priority' ? hintId : undefined}
              />
              <span className="sort-option-label">{t(`fields.${sort}`)}</span>
              {sort === 'priority' && (
                // A description rather than part of the name, so the option reads as "Priority".
                <span id={hintId} className="t-cap c3" aria-hidden="true">
                  {t('downloads.sortPriorityHint')}
                </span>
              )}
              {value === sort && <Icon name="check" strokeWidth={2.4} className="ca" />}
            </label>
          ))}
        </fieldset>
      </div>
    </Sheet>
  )
}

export interface SortMenuProps {
  /** The sort button. */
  anchor: HTMLElement
  value: DownloadSort
  onChange: (sort: DownloadSort) => void
  onClose: () => void
}

/**
 * The sort on desktop: a menu under the sort button, which stays in the pinned header while the
 * list scrolls. The type is a segmented control beside it there.
 */
export function SortMenu({ anchor, value, onChange, onClose }: SortMenuProps) {
  const { t } = useTranslation()
  return (
    <Menu anchor={anchor} label={t('common.sort')} follow onClose={onClose}>
      {DOWNLOAD_SORTS.map((sort) => (
        <MenuItemRadio
          key={sort}
          checked={value === sort}
          label={t(`fields.${sort}`)}
          hint={sort === 'priority' ? t('downloads.sortPriorityHint') : undefined}
          onClick={() => {
            onChange(sort)
            onClose()
            anchor.focus()
          }}
        />
      ))}
    </Menu>
  )
}
