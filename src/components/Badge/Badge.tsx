import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { Icon, type IconName } from '../Icon'
import './Badge.css'

export interface BadgeProps {
  /**
   * `coverage`: accent tint, e.g. "In downloads" or a series' seasons. `res`: resolution, inverted.
   * `hdr`: HDR formats. `audio`: voice-over kinds. `subs`: subtitles, outlined.
   */
  kind?: 'default' | 'coverage' | 'res' | 'hdr' | 'audio' | 'subs'
  icon?: IconName
  className?: string
  children: ReactNode
}

const KIND_CLASS: Record<NonNullable<BadgeProps['kind']>, string | undefined> = {
  default: undefined,
  coverage: 'ks-badge-cov',
  res: 'ks-badge-res',
  hdr: 'ks-badge-hdr',
  audio: 'ks-badge-audio',
  subs: 'ks-badge-sub',
}

export function Badge({ kind = 'default', icon, className, children }: BadgeProps) {
  return (
    <span className={cx('ks-badge', KIND_CLASS[kind], className)}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  )
}
