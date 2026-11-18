import { useId, type ButtonHTMLAttributes } from 'react'
import { Link, type LinkProps } from 'react-router'
import { cx } from '../../lib/cx'
import { Icon, type IconName } from '../Icon'
import './IconButton.css'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName
  /** Required accessible name: icon-only buttons have no visible text. */
  label: string
  variant?: 'plain' | 'filled' | 'glass'
  /** `sm` (36px) is desktop's size, under the 44px touch target. A phone that uses it grows it to
   *  `--touch-min` in its own stylesheet, as Downloads' sort does (`.downloads-sort > .ks-icon-btn`). */
  size?: 'sm' | 'md'
  /** Icon size in px; 20 by default, 18 at `sm`. */
  iconSize?: number
  /** Toggle state. Leave undefined for a plain action button. */
  active?: boolean
  /**
   * A small accent dot in the corner, pointing at something worth opening the button for. The text
   * says why, as the button's accessible description, since the dot alone is only a colour. On a
   * `plain` or `filled` button it follows the theme (`--accent`, ringed in `--bg` to stand off the
   * page); on `glass`, dark in both themes, it's the same light teal in both, with no ring.
   */
  dot?: string
}

type IconButtonVariant = NonNullable<IconButtonProps['variant']>
type IconButtonSize = NonNullable<IconButtonProps['size']>

const iconButtonClass = (variant: IconButtonVariant, size: IconButtonSize, on: boolean | undefined, className?: string) =>
  cx('ks-icon-btn', variant !== 'plain' && `ks-icon-btn-${variant}`, size === 'sm' && 'ks-icon-btn-sm', on && 'is-on', className)

const iconSizeOf = (size: IconButtonSize, iconSize: number | undefined) => iconSize ?? (size === 'sm' ? 18 : 20)

export function IconButton({
  icon,
  label,
  variant = 'plain',
  size = 'md',
  iconSize,
  active,
  dot,
  className,
  type = 'button',
  'aria-describedby': describedBy,
  ...rest
}: IconButtonProps) {
  const dotId = useId()
  return (
    <button
      {...rest}
      type={type}
      className={iconButtonClass(variant, size, active, className)}
      aria-label={label}
      aria-pressed={active}
      aria-describedby={cx(describedBy, dot && dotId) || undefined}
    >
      <Icon name={icon} size={iconSizeOf(size, iconSize)} />
      {dot && (
        <>
          <span className="ks-icon-btn-dot" aria-hidden="true" />
          <span id={dotId} hidden>
            {dot}
          </span>
        </>
      )}
    </button>
  )
}

export interface IconLinkProps extends LinkProps {
  icon: IconName
  /** Required accessible name: icon-only links have no visible text. */
  label: string
  variant?: IconButtonProps['variant']
  size?: IconButtonProps['size']
  /** Icon size in px; 20 by default, 18 at `sm`. */
  iconSize?: number
  /** The look of a toggle that's on, the accent's tint, for a link that says something is so. */
  on?: boolean
}

/** A link that looks like an `IconButton`, for an action that takes the person to another screen. */
export function IconLink({ icon, label, variant = 'plain', size = 'md', iconSize, on, className, ...rest }: IconLinkProps) {
  return (
    <Link {...rest} className={iconButtonClass(variant, size, on, className)} aria-label={label}>
      <Icon name={icon} size={iconSizeOf(size, iconSize)} />
    </Link>
  )
}
