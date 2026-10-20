import type { ButtonHTMLAttributes } from 'react'
import { cx } from '../../lib/cx'
import { Icon, type IconName } from '../Icon'
import './IconButton.css'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName
  /** Required accessible name: icon-only buttons have no visible text. */
  label: string
  variant?: 'plain' | 'filled' | 'glass'
  /** `sm` (36px) is for desktop only. */
  size?: 'sm' | 'md'
  /** Icon size in px; 20 by default, 18 at `sm`. */
  iconSize?: number
  /** Toggle state. Leave undefined for a plain action button. */
  active?: boolean
}

export function IconButton({
  icon,
  label,
  variant = 'plain',
  size = 'md',
  iconSize,
  active,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cx(
        'ks-icon-btn',
        variant !== 'plain' && `ks-icon-btn-${variant}`,
        size === 'sm' && 'ks-icon-btn-sm',
        active && 'is-on',
        className,
      )}
      aria-label={label}
      aria-pressed={active}
    >
      <Icon name={icon} size={iconSize ?? (size === 'sm' ? 18 : 20)} />
    </button>
  )
}
