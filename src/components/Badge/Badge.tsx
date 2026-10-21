import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { Icon, type IconName } from '../Icon'
import './Badge.css'

export interface BadgeProps {
  /** `coverage`: accent tint, e.g. "In downloads". */
  kind?: 'default' | 'coverage'
  icon?: IconName
  className?: string
  children: ReactNode
}

export function Badge({ kind = 'default', icon, className, children }: BadgeProps) {
  return (
    <span className={cx('ks-badge', kind === 'coverage' && 'ks-badge-cov', className)}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  )
}
