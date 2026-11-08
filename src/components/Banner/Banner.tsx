import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { Button } from '../Button'
import { Icon, type IconName } from '../Icon'
import './Banner.css'

export interface BannerProps {
  tone?: 'warning' | 'error' | 'info'
  /** Defaults by tone: wifi-off, alert, info. */
  icon?: IconName
  title?: string
  /** Shorthand for a ghost sm Button as the action. */
  actionLabel?: string
  onAction?: () => void
  actionDisabled?: boolean
  /** A second ghost sm Button after the action. */
  secondaryActionLabel?: string
  onSecondaryAction?: () => void
  /** False when a live region around the banner announces it instead. */
  live?: boolean
  className?: string
  children?: ReactNode
}

const DEFAULT_ICON: Record<NonNullable<BannerProps['tone']>, IconName> = {
  warning: 'wifi-off',
  error: 'alert',
  info: 'info',
}

export function Banner({
  tone = 'warning',
  icon,
  title,
  actionLabel,
  onAction,
  actionDisabled,
  secondaryActionLabel,
  onSecondaryAction,
  live = true,
  className,
  children,
}: BannerProps) {
  return (
    <div
      className={cx('ks-banner', tone !== 'warning' && `ks-banner-${tone}`, secondaryActionLabel && 'has-two-actions', className)}
      role={live ? (tone === 'error' ? 'alert' : 'status') : undefined}
    >
      <Icon name={icon ?? DEFAULT_ICON[tone]} size={20} />
      <div className="ks-banner-body">
        {title && <div className="t-label ks-banner-title">{title}</div>}
        {children && <div className={cx('t-cap', title && 'c2')}>{children}</div>}
      </div>
      {(actionLabel || secondaryActionLabel) && (
        <div className="ks-banner-actions">
          {actionLabel && (
            <Button variant="ghost" size="sm" onClick={onAction} disabled={actionDisabled}>
              {actionLabel}
            </Button>
          )}
          {secondaryActionLabel && (
            <Button variant="ghost" size="sm" onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
