import { cx } from '../../lib/cx'
import type { DownloadStatus } from '../../torrents/status'
import './ProgressBar.css'

export interface ProgressBarProps {
  /** 0–1. Leave undefined for an indeterminate bar. */
  value?: number
  /** Colors the fill like the matching StatusChip. */
  status?: DownloadStatus
  /** Accessible name. */
  label: string
  size?: 'md' | 'lg'
  className?: string
}

export function ProgressBar({ value, status = 'downloading', label, size = 'md', className }: ProgressBarProps) {
  const percent = value === undefined ? undefined : Math.round(Math.min(1, Math.max(0, value)) * 1000) / 10
  return (
    <div
      className={cx('ks-bar', size === 'lg' && 'ks-bar-lg', percent === undefined && 'is-indet', className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent === undefined ? undefined : Math.floor(percent)}
    >
      <i className={`b-${status}`} style={percent === undefined ? undefined : { width: `${percent}%` }} />
    </div>
  )
}
