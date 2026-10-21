import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { Button } from '../Button'
import { Icon, type IconName } from '../Icon'
import './EmptyState.css'

export interface EmptyStateProps {
  icon: IconName
  title: string
  tone?: 'accent' | 'muted' | 'error'
  actionLabel?: string
  actionIcon?: IconName
  onAction?: () => void
  className?: string
  children?: ReactNode
}

export function EmptyState({
  icon,
  title,
  tone = 'accent',
  actionLabel,
  actionIcon,
  onAction,
  className,
  children,
}: EmptyStateProps) {
  return (
    <div className={cx('ks-empty', className)}>
      <div className={cx('ks-empty-ic', tone !== 'accent' && `is-${tone}`)}>
        <Icon name={icon} size={32} />
      </div>
      <h2 className="t-h3">{title}</h2>
      {children && <p className="t-body c2 ks-empty-body">{children}</p>}
      {actionLabel && (
        <Button variant="tonal" icon={actionIcon} onClick={onAction} className="ks-empty-action">
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
