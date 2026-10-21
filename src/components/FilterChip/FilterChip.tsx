import type { ButtonHTMLAttributes } from 'react'
import { cx } from '../../lib/cx'
import { Icon, type IconName } from '../Icon'
import './FilterChip.css'

export interface FilterChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean
  /** Shown after the label in tabular figures. */
  count?: number
  icon?: IconName
  /** Raised background, for chips over content. */
  solid?: boolean
}

export function FilterChip({
  selected = false,
  count,
  icon,
  solid,
  className,
  type = 'button',
  children,
  ...rest
}: FilterChipProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cx('ks-chip', solid && 'ks-chip-solid', selected && 'is-on', className)}
      aria-pressed={selected}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
      {/* The space keeps the accessible name readable ("Seeding 3"); flex layout drops it visually. */}
      {count !== undefined && <> <span className="n">{count}</span></>}
    </button>
  )
}
