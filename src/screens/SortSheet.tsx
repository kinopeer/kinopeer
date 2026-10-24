import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { DOWNLOAD_SORTS, type DownloadSort } from '../torrents/sort'

export interface SortSheetProps {
  open: boolean
  value: DownloadSort
  onChange: (sort: DownloadSort) => void
  onClose: () => void
}

/** Picks the order of the downloads list. A pick applies right away; Done closes the sheet. */
export function SortSheet({ open, value, onChange, onClose }: SortSheetProps) {
  const { t } = useTranslation()
  const name = useId()
  const hintId = useId()

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('downloads.sort')}
      action={
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('downloads.sortDone')}
        </Button>
      }
    >
      <fieldset className="sort-options">
        <legend className="sr-only">{t('downloads.sort')}</legend>
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
            <span className="sort-option-label">{t(`downloads.sorts.${sort}`)}</span>
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
    </Sheet>
  )
}
