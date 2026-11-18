import type { ButtonHTMLAttributes } from 'react'
import { Link, type LinkProps } from 'react-router'
import { cx } from '../../lib/cx'
import { Icon, type IconName } from '../Icon'
import './Button.css'

export type ButtonVariant = 'primary' | 'secondary' | 'tonal' | 'ghost' | 'danger' | 'danger-ghost'
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

interface ButtonLook {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  loading?: boolean
  className?: string
}

const buttonClass = ({ variant = 'primary', size = 'md', block, loading, className }: ButtonLook) =>
  cx('ks-btn', `ks-btn-${variant}`, size !== 'md' && `ks-btn-${size}`, block && 'ks-btn-block', loading && 'is-loading', className)

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
      className={buttonClass({ variant, size, block, loading, className })}
      aria-busy={loading || undefined}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : 20} />}
      {children}
    </button>
  )
}

export interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: IconName
  /** Full width. */
  block?: boolean
}

/** A link that looks like a `Button`, for an action that takes the person to another screen. */
export function ButtonLink({ variant = 'primary', size = 'md', icon, block, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link {...rest} className={buttonClass({ variant, size, block, className })}>
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : 20} />}
      {children}
    </Link>
  )
}
