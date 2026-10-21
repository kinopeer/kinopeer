import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'
import type { DownloadStatus } from '../../torrents/status'
import './StatusChip.css'

export interface StatusChipProps {
  status: DownloadStatus
  className?: string
  /** The localized status label. */
  children: ReactNode
}

/** Status pill. The shape of the dot differs per status, so it doesn't rely on color alone. */
export function StatusChip({ status, className, children }: StatusChipProps) {
  return <span className={cx('ks-status', `st-${status}`, className)}>{children}</span>
}
