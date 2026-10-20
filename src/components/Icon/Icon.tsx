import type { CSSProperties } from 'react'
import { cx } from '../../lib/cx'
import { DEFAULT_STROKE, ICONS, type IconName } from './icons'
import './Icon.css'

export interface IconProps {
  name: IconName
  size?: number
  /** Accessible name. Without it the icon is decorative and hidden from assistive tech. */
  label?: string
  strokeWidth?: number
  /** Solid fill instead of outline, e.g. a rating star. */
  filled?: boolean
  className?: string
  style?: CSSProperties
}

export function Icon({ name, size = 20, label, strokeWidth, filled, className, style }: IconProps) {
  const stroke = strokeWidth ?? DEFAULT_STROKE[name]
  return (
    <svg
      className={cx('ks-ic', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{
        ...(stroke ? { strokeWidth: stroke } : null),
        ...(filled ? { fill: 'currentColor', stroke: 'none' } : null),
        ...style,
      }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={ICONS[name]} />
    </svg>
  )
}
