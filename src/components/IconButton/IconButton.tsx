import { useId, type ButtonHTMLAttributes } from 'react'
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
   * says why, as the button's accessible description, since the dot alone is only a colour.
   */
  dot?: string
}

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
      className={cx(
        'ks-icon-btn',
        variant !== 'plain' && `ks-icon-btn-${variant}`,
        size === 'sm' && 'ks-icon-btn-sm',
        active && 'is-on',
        className,
      )}
      aria-label={label}
      aria-pressed={active}
      aria-describedby={cx(describedBy, dot && dotId) || undefined}
    >
      <Icon name={icon} size={iconSize ?? (size === 'sm' ? 18 : 20)} />
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
