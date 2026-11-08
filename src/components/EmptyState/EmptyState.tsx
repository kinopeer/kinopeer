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
  /** A second, ghost Button beside the action. */
  secondaryActionLabel?: string
  onSecondaryAction?: () => void
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
  secondaryActionLabel,
  onSecondaryAction,
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
      {(actionLabel || secondaryActionLabel) && (
        <div className="ks-empty-actions">
          {actionLabel && (
            <Button variant="tonal" icon={actionIcon} onClick={onAction}>
              {actionLabel}
            </Button>
          )}
          {secondaryActionLabel && (
            <Button variant="ghost" onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
