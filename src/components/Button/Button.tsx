import type { ButtonHTMLAttributes } from 'react'
import { cx } from '../../lib/cx'
import { Icon, type IconName } from '../Icon'
import './Button.css'

/** `glass` is for over posters and backdrops, beside IconButton's glass buttons. */
export type ButtonVariant = 'primary' | 'secondary' | 'tonal' | 'ghost' | 'danger' | 'danger-ghost' | 'glass'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: IconName
  /** Hides the label behind a spinner without changing the width. */
  loading?: boolean
  /** Full width. */
  block?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  block,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cx(
        'ks-btn',
        `ks-btn-${variant}`,
        size !== 'md' && `ks-btn-${size}`,
        block && 'ks-btn-block',
        loading && 'is-loading',
        className,
      )}
      aria-busy={loading || undefined}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : 20} />}
      {children}
    </button>
  )
}
