import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { Menu, MenuItemRadio } from '../components/Menu'
import { STATUS_FILTERS, type StatusFilter } from '../torrents/status'

export interface StatusMenuProps {
  value: StatusFilter
  onChange: (filter: StatusFilter) => void
  /** How many torrents each status has; not set while loading. */
  counts?: Record<StatusFilter, number>
}

/**
 * The status filter on desktop: one button with the picked status and its count, opening a menu of
 * every status with its count. It keeps the header on one row where the phone's chips would wrap.
 * A dot on the button tells that some torrents have errors while another status hides them.
 */
export function StatusMenu({ value, onChange, counts }: StatusMenuProps) {
  const { t } = useTranslation()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const name = (filter: StatusFilter) => (filter === 'all' ? t('common.all') : t(`status.${filter}`))
  const count = counts?.[value]
  const errors = value === 'all' || value === 'error' ? 0 : (counts?.error ?? 0)

  const label =
    count === undefined
      ? t('downloads.statusButton', { status: name(value) })
      : errors > 0
        ? t('downloads.statusButtonErrors', { status: name(value), count, errors })
        : t('downloads.statusButtonCount', { status: name(value), count })

  return (
    <>
      <Button
        variant={value === 'all' ? 'secondary' : 'tonal'}
        size="sm"
        icon="filter"
        className="downloads-status"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-label={label}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        {value === 'all' ? t('downloads.allStatuses') : name(value)}
        {count !== undefined && <span className="t-cap downloads-status-count ks-num">{count}</span>}
        <Icon name="chevron-down" size={14} />
        {errors > 0 && <span className="downloads-status-dot" />}
      </Button>
      {anchor && (
        <Menu
          anchor={anchor}
          label={t('downloads.filtersLabel')}
          align="start"
          follow
          className="downloads-status-menu"
          onClose={() => setAnchor(null)}
        >
          {STATUS_FILTERS.map((filter) => (
            <MenuItemRadio
              key={filter}
              checked={value === filter}
              label={name(filter)}
              hint={counts ? String(counts[filter]) : undefined}
              aria-label={counts ? t('downloads.statusOption', { status: name(filter), count: counts[filter] }) : undefined}
              className={filter === 'error' && counts && counts.error > 0 ? 'is-error' : undefined}
              onClick={() => {
                onChange(filter)
                setAnchor(null)
                anchor.focus()
              }}
            />
          ))}
        </Menu>
      )}
    </>
  )
}
